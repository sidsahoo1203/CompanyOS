-- Integration findings: removed members' requests could be revived by an edit,
-- and every document view wrote an audit row (unbounded growth).
CREATE OR REPLACE FUNCTION app.edit_approval(p_workspace uuid,p_id uuid,p_digest text,p_target text,p_payload text)
RETURNS TABLE(edit_outcome text,edit_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_old app.approval_request; v_role text; v_outcome text; v_effect text; v_id uuid:=gen_random_uuid();
BEGIN
 PERFORM app.agent_authorize(p_workspace);
 v_role:=app.role_for(p_workspace);
 SELECT * INTO v_old FROM app.approval_request WHERE workspace_id=p_workspace AND id=p_id FOR UPDATE;
 IF NOT FOUND OR NOT app.approval_readable(p_workspace,p_id) THEN RAISE EXCEPTION 'Approval unavailable' USING ERRCODE='P0002'; END IF;
 IF (SELECT count(*) FROM app.audit_event WHERE workspace_id=p_workspace AND actor_id=app.actor_id()
 AND action IN ('approval.edited','approval.approved','approval.rejected','approval.denied') AND created_at>now()-interval '1 minute')>=30 THEN
 RETURN QUERY SELECT 'rate_limited'::text,NULL::uuid; RETURN; END IF;
 IF v_old.requested_by<>app.actor_id() AND v_role NOT IN ('owner','admin') THEN v_outcome:='forbidden';
 ELSIF v_old.status NOT IN ('pending','expired') OR EXISTS(SELECT 1 FROM app.approval_request
 WHERE run_id=v_old.run_id AND proposal_index=v_old.proposal_index AND revision>v_old.revision) THEN v_outcome:='closed';
 -- A request from someone no longer in the workspace stays closed; editing must not revive it.
 ELSIF NOT EXISTS(SELECT 1 FROM app.workspace_membership WHERE workspace_id=p_workspace AND user_id=v_old.requested_by) THEN v_outcome:='closed';
 ELSIF v_old.digest IS DISTINCT FROM p_digest THEN v_outcome:='stale';
 ELSIF v_old.revision>=20 THEN v_outcome:='revision_limit';
 ELSIF NOT EXISTS(SELECT 1 FROM app.agent_run r JOIN app.agent_skill s ON s.workspace_id=r.workspace_id AND s.id=r.skill_id
 WHERE r.workspace_id=p_workspace AND r.id=v_old.run_id AND s.enabled) THEN v_outcome:='skill_disabled';
 ELSIF p_target IS NULL OR p_payload IS NULL OR length(p_payload) NOT BETWEEN 1 AND 6000 OR NOT app.approval_target_valid(v_old.kind,p_target) THEN v_outcome:='invalid_target';
 ELSIF NOT app.approval_text_safe(p_target) OR NOT app.approval_text_safe(p_payload) THEN v_outcome:='unsafe_content';
 ELSIF p_target=v_old.target AND p_payload=v_old.payload THEN v_outcome:='unchanged';
 ELSE
 IF v_old.status='pending' THEN UPDATE app.approval_request SET status='superseded' WHERE id=p_id; END IF;
 v_effect:=app.approval_effect(v_old.kind,p_target);
 INSERT INTO app.approval_request(id,workspace_id,run_id,proposal_index,revision,supersedes,kind,target,payload,inputs,sources,
 expected_effect,digest,requested_by,authored_by,expires_at)
 VALUES(v_id,p_workspace,v_old.run_id,v_old.proposal_index,v_old.revision+1,p_id,v_old.kind,p_target,p_payload,v_old.inputs,v_old.sources,
 v_effect,app.approval_digest(v_id,v_old.revision+1,v_old.kind,p_target,p_payload,v_old.inputs,v_old.sources,v_effect),
 v_old.requested_by,app.actor_id(),now()+interval '48 hours');
 INSERT INTO app.audit_event(workspace_id,actor_id,action,target,risk,metadata)
 VALUES(p_workspace,app.actor_id(),'approval.edited',v_id::text,'medium',jsonb_build_object('previous',p_id));
 RETURN QUERY SELECT 'edited'::text,v_id; RETURN;
 END IF;
 INSERT INTO app.audit_event(workspace_id,actor_id,action,target,result,risk,metadata)
 VALUES(p_workspace,app.actor_id(),'approval.denied',p_id::text,'denied','high',jsonb_build_object('reason',v_outcome,'decision','edit'));
 RETURN QUERY SELECT v_outcome,NULL::uuid;
END $$;
CREATE OR REPLACE FUNCTION app.knowledge_event(p_workspace uuid,p_document uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF app.document_readable(p_workspace,p_document) IS DISTINCT FROM true THEN RAISE EXCEPTION 'Document unavailable' USING ERRCODE='P0002'; END IF;
 -- One access event per person and document per 10 minutes is enough evidence.
 IF NOT EXISTS(SELECT 1 FROM app.audit_event WHERE workspace_id=p_workspace AND actor_id=app.actor_id()
 AND action='document.accessed' AND target=p_document::text AND created_at>now()-interval '10 minutes') THEN
 INSERT INTO app.audit_event(workspace_id,actor_id,action,target) VALUES(p_workspace,app.actor_id(),'document.accessed',p_document::text);
 END IF;
END $$;
REVOKE ALL ON FUNCTION app.edit_approval(uuid,uuid,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.knowledge_event(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.edit_approval(uuid,uuid,text,text,text),app.knowledge_event(uuid,uuid) TO companyos_app;
