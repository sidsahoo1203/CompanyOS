-- Milestone 4: approval requests, immutable revisions, a local-outbox execution
-- gate with replay protection, and persisted denial auditing.
ALTER TABLE app.audit_event DROP CONSTRAINT audit_event_action_check;
ALTER TABLE app.audit_event ADD CONSTRAINT audit_event_action_check CHECK(action IN (
 'workspace.created','workspace.updated','member.invited','member.joined','member.role_changed',
 'knowledge.created','knowledge.updated','document.uploaded','document.processed','document.accessed','knowledge.searched',
 'procedure.published','skill.created','skill.toggled','run.created','run.finished',
 'approval.requested','approval.edited','approval.approved','approval.rejected','approval.expired','approval.denied',
 'action.executed'
));
ALTER TABLE app.audit_event DROP CONSTRAINT audit_event_result_check;
ALTER TABLE app.audit_event ADD CONSTRAINT audit_event_result_check CHECK(result IN ('success','denied'));
ALTER TABLE app.audit_event DROP CONSTRAINT audit_event_risk_check;
ALTER TABLE app.audit_event ADD CONSTRAINT audit_event_risk_check CHECK(risk IN ('low','medium','high'));
CREATE INDEX audit_actor_time_idx ON app.audit_event(workspace_id,actor_id,created_at DESC);
CREATE INDEX audit_target_idx ON app.audit_event(workspace_id,target);

CREATE TABLE app.approval_request (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, run_id uuid NOT NULL,
 proposal_index integer NOT NULL CHECK(proposal_index BETWEEN 0 AND 2),
 revision integer NOT NULL CHECK(revision BETWEEN 1 AND 20), supersedes uuid,
 kind text NOT NULL CHECK(kind='send_message'),
 target text NOT NULL CHECK(length(target) BETWEEN 1 AND 254),
 payload text NOT NULL CHECK(length(payload) BETWEEN 1 AND 6000),
 inputs jsonb NOT NULL CHECK(jsonb_typeof(inputs)='object'),
 sources jsonb NOT NULL CHECK(jsonb_typeof(sources)='array' AND jsonb_array_length(sources)>0),
 expected_effect text NOT NULL, digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','rejected','superseded','expired','executed')),
 requested_by text NOT NULL REFERENCES public."user"(id), authored_by text NOT NULL REFERENCES public."user"(id),
 created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
 decided_by text REFERENCES public."user"(id), decided_at timestamptz,
 decision_note text CHECK(length(decision_note)<=500),
 FOREIGN KEY(workspace_id,run_id) REFERENCES app.agent_run(workspace_id,id),
 FOREIGN KEY(workspace_id,supersedes) REFERENCES app.approval_request(workspace_id,id),
 UNIQUE(workspace_id,id), UNIQUE(run_id,proposal_index,revision),
 CHECK((status IN ('rejected','executed'))=(decided_by IS NOT NULL AND decided_at IS NOT NULL))
);
CREATE UNIQUE INDEX approval_one_pending ON app.approval_request(run_id,proposal_index) WHERE status='pending';
CREATE INDEX approval_workspace_time ON app.approval_request(workspace_id,created_at DESC);
CREATE TABLE app.action_execution (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, approval_id uuid NOT NULL,
 idempotency_key uuid NOT NULL, digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
 executor text NOT NULL CHECK(executor='local-outbox-v1'),
 kind text NOT NULL, target text NOT NULL, payload text NOT NULL,
 status text NOT NULL DEFAULT 'recorded_locally' CHECK(status='recorded_locally'),
 executed_by text NOT NULL REFERENCES public."user"(id), executed_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,approval_id) REFERENCES app.approval_request(workspace_id,id),
 UNIQUE(approval_id), UNIQUE(workspace_id,idempotency_key)
);

CREATE FUNCTION app.approval_effect(p_kind text,p_target text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT CASE WHEN p_kind='send_message' THEN 'Records this exact message for '||p_target||
 ' in the CompanyOS local outbox on this computer. Nothing is emailed or sent to any external service.' END
$$;
CREATE FUNCTION app.approval_digest(p_id uuid,p_revision integer,p_kind text,p_target text,p_payload text,p_inputs jsonb,p_sources jsonb,p_effect text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT encode(sha256(convert_to(jsonb_build_object('id',p_id,'revision',p_revision,'kind',p_kind,'target',p_target,
 'payload',p_payload,'inputs',p_inputs,'sources',p_sources,'effect',p_effect)::text,'UTF8')),'hex')
$$;
-- Control, zero-width and bidirectional override characters can disguise what is approved.
CREATE FUNCTION app.approval_text_safe(p_value text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT p_value !~ '[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁠-⁩﻿]'
$$;
CREATE FUNCTION app.approval_target_valid(p_kind text,p_target text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT p_kind='send_message' AND length(p_target)<=254
 AND p_target ~ '^[^@[:space:]<>(),;:"\[\]]+@[^@[:space:]<>(),;:"\[\]]+\.[A-Za-z]{2,}$'
$$;
CREATE FUNCTION app.approval_readable(p_workspace uuid,p_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM app.approval_request a
 JOIN app.agent_run r ON r.workspace_id=a.workspace_id AND r.id=a.run_id
 JOIN app.agent_skill s ON s.workspace_id=r.workspace_id AND s.id=r.skill_id
 WHERE a.workspace_id=p_workspace AND a.id=p_id AND p_workspace=app.active_workspace()
 AND (a.requested_by=app.actor_id() OR app.role_for(p_workspace) IN ('owner','admin'))
 AND app.version_readable(p_workspace,s.version_id))
$$;
ALTER TABLE app.approval_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.action_execution ENABLE ROW LEVEL SECURITY;
CREATE POLICY approval_read ON app.approval_request FOR SELECT TO companyos_app USING(app.approval_readable(workspace_id,id));
CREATE POLICY execution_read ON app.action_execution FOR SELECT TO companyos_app USING(app.approval_readable(workspace_id,approval_id));
GRANT SELECT ON app.approval_request,app.action_execution TO companyos_app;

CREATE FUNCTION app.request_approval(p_workspace uuid,p_run uuid,p_index integer) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_run app.agent_run; v_proposal jsonb; v_existing uuid; v_effect text; v_id uuid:=gen_random_uuid();
BEGIN
 PERFORM app.agent_authorize(p_workspace);
 PERFORM 1 FROM app.workspace WHERE id=p_workspace FOR UPDATE;
 SELECT * INTO v_run FROM app.agent_run WHERE workspace_id=p_workspace AND id=p_run AND initiated_by=app.actor_id();
 IF NOT FOUND OR NOT app.run_readable(p_workspace,p_run) OR v_run.status<>'draft_ready' OR p_index NOT BETWEEN 0 AND 2 THEN
 RAISE EXCEPTION 'Run unavailable' USING ERRCODE='P0002'; END IF;
 SELECT id INTO v_existing FROM app.approval_request WHERE run_id=p_run AND proposal_index=p_index ORDER BY revision DESC LIMIT 1;
 IF FOUND THEN RETURN v_existing; END IF;
 v_proposal:=v_run.output->'proposals'->p_index;
 IF v_proposal IS NULL OR NOT EXISTS(SELECT 1 FROM app.agent_skill WHERE workspace_id=p_workspace AND id=v_run.skill_id AND enabled) THEN
 RAISE EXCEPTION 'Proposal unavailable' USING ERRCODE='P0002'; END IF;
 IF v_proposal->>'kind' IS DISTINCT FROM 'send_message' OR (v_proposal->>'approvalRequired') IS DISTINCT FROM 'true'
 OR (v_proposal->>'executionAllowed') IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'Invalid proposal' USING ERRCODE='22023'; END IF;
 IF (SELECT count(*) FROM app.approval_request WHERE workspace_id=p_workspace)>=2000 OR
 (SELECT count(*) FROM app.approval_request WHERE workspace_id=p_workspace AND authored_by=app.actor_id() AND created_at>now()-interval '1 minute')>=20 THEN
 RAISE EXCEPTION 'Approval limit' USING ERRCODE='54000'; END IF;
 v_effect:=app.approval_effect('send_message',v_proposal->>'target');
 INSERT INTO app.approval_request(id,workspace_id,run_id,proposal_index,revision,kind,target,payload,inputs,sources,
 expected_effect,digest,requested_by,authored_by,expires_at)
 VALUES(v_id,p_workspace,p_run,p_index,1,'send_message',v_proposal->>'target',v_proposal->>'payload',v_run.input,v_run.citations,
 v_effect,app.approval_digest(v_id,1,'send_message',v_proposal->>'target',v_proposal->>'payload',v_run.input,v_run.citations,v_effect),
 app.actor_id(),app.actor_id(),now()+interval '48 hours');
 INSERT INTO app.audit_event(workspace_id,actor_id,action,target,risk) VALUES(p_workspace,app.actor_id(),'approval.requested',v_id::text,'medium');
 RETURN v_id;
END $$;
CREATE FUNCTION app.expire_approvals(p_workspace uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_id uuid;
BEGIN
 PERFORM app.agent_authorize(p_workspace);
 FOR v_id IN UPDATE app.approval_request SET status='expired'
 WHERE workspace_id=p_workspace AND status='pending' AND expires_at<=now() RETURNING id LOOP
 INSERT INTO app.audit_event(workspace_id,actor_id,action,target) VALUES(p_workspace,app.actor_id(),'approval.expired',v_id::text);
 END LOOP;
END $$;
-- Outcomes are returned rather than raised so denied attempts stay in the audit log.
CREATE FUNCTION app.edit_approval(p_workspace uuid,p_id uuid,p_digest text,p_target text,p_payload text)
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
-- Deterministic execution gate. Approval consumes the exact pending snapshot and
-- records it in the local outbox in one transaction; nothing leaves this computer.
CREATE FUNCTION app.decide_approval(p_workspace uuid,p_id uuid,p_decision text,p_digest text,p_key uuid,p_note text)
RETURNS TABLE(decision_outcome text,decision_execution uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_req app.approval_request; v_exec app.action_execution; v_role text; v_outcome text; v_exec_id uuid;
BEGIN
 PERFORM app.agent_authorize(p_workspace);
 v_role:=app.role_for(p_workspace);
 IF p_decision IS NULL OR p_decision NOT IN ('approve','reject') OR length(p_note)>500 THEN
 RAISE EXCEPTION 'Invalid decision' USING ERRCODE='22023'; END IF;
 SELECT * INTO v_req FROM app.approval_request WHERE workspace_id=p_workspace AND id=p_id FOR UPDATE;
 IF NOT FOUND OR NOT app.approval_readable(p_workspace,p_id) THEN RAISE EXCEPTION 'Approval unavailable' USING ERRCODE='P0002'; END IF;
 IF (SELECT count(*) FROM app.audit_event WHERE workspace_id=p_workspace AND actor_id=app.actor_id()
 AND action IN ('approval.edited','approval.approved','approval.rejected','approval.denied') AND created_at>now()-interval '1 minute')>=30 THEN
 RETURN QUERY SELECT 'rate_limited'::text,NULL::uuid; RETURN; END IF;
 IF v_req.status='executed' THEN
 SELECT * INTO v_exec FROM app.action_execution WHERE approval_id=p_id;
 IF p_decision='approve' AND v_exec.idempotency_key=p_key AND v_exec.executed_by=app.actor_id() THEN
 RETURN QUERY SELECT 'executed'::text,v_exec.id; RETURN; END IF;
 v_outcome:='replay';
 ELSIF v_role NOT IN ('owner','admin') THEN v_outcome:='forbidden';
 ELSIF v_req.status='pending' AND v_req.expires_at<=now() THEN
 UPDATE app.approval_request SET status='expired' WHERE id=p_id;
 INSERT INTO app.audit_event(workspace_id,actor_id,action,target) VALUES(p_workspace,app.actor_id(),'approval.expired',p_id::text);
 v_outcome:='expired';
 ELSIF v_req.status='expired' THEN v_outcome:='expired';
 ELSIF v_req.status<>'pending' THEN v_outcome:='closed';
 ELSIF v_req.digest IS DISTINCT FROM p_digest THEN v_outcome:='stale';
 ELSIF NOT EXISTS(SELECT 1 FROM app.agent_run r JOIN app.agent_skill s ON s.workspace_id=r.workspace_id AND s.id=r.skill_id
 WHERE r.workspace_id=p_workspace AND r.id=v_req.run_id AND s.enabled) THEN v_outcome:='skill_disabled';
 ELSIF p_decision='reject' THEN
 UPDATE app.approval_request SET status='rejected',decided_by=app.actor_id(),decided_at=now(),decision_note=nullif(btrim(p_note),'') WHERE id=p_id;
 INSERT INTO app.audit_event(workspace_id,actor_id,action,target,risk) VALUES(p_workspace,app.actor_id(),'approval.rejected',p_id::text,'medium');
 RETURN QUERY SELECT 'rejected'::text,NULL::uuid; RETURN;
 ELSIF v_req.authored_by=app.actor_id() AND v_role<>'owner' THEN v_outcome:='self_approval';
 ELSIF NOT app.approval_target_valid(v_req.kind,v_req.target) THEN v_outcome:='invalid_target';
 ELSIF NOT app.approval_text_safe(v_req.target) OR NOT app.approval_text_safe(v_req.payload) THEN v_outcome:='unsafe_content';
 ELSIF p_key IS NULL OR EXISTS(SELECT 1 FROM app.action_execution WHERE workspace_id=p_workspace AND idempotency_key=p_key) THEN v_outcome:='replay';
 ELSE
 UPDATE app.approval_request SET status='executed',decided_by=app.actor_id(),decided_at=now(),decision_note=nullif(btrim(p_note),'') WHERE id=p_id;
 INSERT INTO app.action_execution(workspace_id,approval_id,idempotency_key,digest,executor,kind,target,payload,executed_by)
 VALUES(p_workspace,p_id,p_key,v_req.digest,'local-outbox-v1',v_req.kind,v_req.target,v_req.payload,app.actor_id()) RETURNING id INTO v_exec_id;
 INSERT INTO app.audit_event(workspace_id,actor_id,action,target,risk) VALUES(p_workspace,app.actor_id(),'approval.approved',p_id::text,'high');
 INSERT INTO app.audit_event(workspace_id,actor_id,action,target,risk,metadata)
 VALUES(p_workspace,app.actor_id(),'action.executed',v_exec_id::text,'high',jsonb_build_object('approval',p_id,'executor','local-outbox-v1'));
 RETURN QUERY SELECT 'executed'::text,v_exec_id; RETURN;
 END IF;
 INSERT INTO app.audit_event(workspace_id,actor_id,action,target,result,risk,metadata)
 VALUES(p_workspace,app.actor_id(),'approval.denied',p_id::text,'denied','high',jsonb_build_object('reason',v_outcome,'decision',p_decision));
 RETURN QUERY SELECT v_outcome,NULL::uuid;
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO companyos_app;
