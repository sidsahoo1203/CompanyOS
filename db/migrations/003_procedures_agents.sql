CREATE TABLE app.procedure (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES app.workspace(id),
 title text NOT NULL CHECK(length(title) BETWEEN 2 AND 120), created_by text NOT NULL REFERENCES public."user"(id),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(workspace_id,id)
);
CREATE TABLE app.procedure_version (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, procedure_id uuid NOT NULL,
 version integer NOT NULL CHECK(version>0), title text NOT NULL CHECK(length(title) BETWEEN 2 AND 120),
 instructions text NOT NULL CHECK(length(instructions) BETWEEN 10 AND 6000),
 created_by text NOT NULL REFERENCES public."user"(id), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,procedure_id) REFERENCES app.procedure(workspace_id,id),
 UNIQUE(workspace_id,id), UNIQUE(procedure_id,version)
);
CREATE TABLE app.procedure_source (
 workspace_id uuid NOT NULL, version_id uuid NOT NULL, source_id uuid NOT NULL,
 PRIMARY KEY(version_id,source_id),
 FOREIGN KEY(workspace_id,version_id) REFERENCES app.procedure_version(workspace_id,id),
 FOREIGN KEY(workspace_id,source_id) REFERENCES app.knowledge_source(workspace_id,id)
);
CREATE TABLE app.agent_skill (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, version_id uuid NOT NULL,
 name text NOT NULL CHECK(length(name) BETWEEN 2 AND 120), operation text NOT NULL CHECK(operation IN ('source_brief','message_draft')),
 input_schema jsonb NOT NULL, output_schema jsonb NOT NULL, contract_version integer NOT NULL DEFAULT 1 CHECK(contract_version=1),
 max_tokens integer NOT NULL CHECK(max_tokens BETWEEN 128 AND 16000),
 max_cost_microusd integer NOT NULL CHECK(max_cost_microusd BETWEEN 0 AND 1000000),
 timeout_ms integer NOT NULL CHECK(timeout_ms BETWEEN 1000 AND 15000), enabled boolean NOT NULL DEFAULT true,
 created_by text NOT NULL REFERENCES public."user"(id), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,version_id) REFERENCES app.procedure_version(workspace_id,id), UNIQUE(workspace_id,id)
);
CREATE TABLE app.agent_run (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL, skill_id uuid NOT NULL,
 initiated_by text NOT NULL REFERENCES public."user"(id), request_key uuid NOT NULL,
 input jsonb NOT NULL CHECK(jsonb_typeof(input)='object' AND octet_length(input::text)<=16000),
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','draft_ready','failed','timed_out')),
 current_step integer NOT NULL DEFAULT 1 CHECK(current_step BETWEEN 1 AND 4),
 output jsonb, citations jsonb, error_code text, engine text, usage_kind text NOT NULL DEFAULT 'unknown' CHECK(usage_kind IN ('unknown','not_applicable','reported')),
 input_tokens integer CHECK(input_tokens BETWEEN 0 AND 10000000), output_tokens integer CHECK(output_tokens BETWEEN 0 AND 10000000),
 cost_microusd bigint CHECK(cost_microusd BETWEEN 0 AND 1000000000000),
 lease uuid, deadline timestamptz NOT NULL DEFAULT now()+interval '10 minutes',
 created_at timestamptz NOT NULL DEFAULT now(), started_at timestamptz, finished_at timestamptz,
 FOREIGN KEY(workspace_id,skill_id) REFERENCES app.agent_skill(workspace_id,id),
 UNIQUE(workspace_id,id), UNIQUE(workspace_id,initiated_by,request_key),
 CHECK((status='draft_ready' AND output IS NOT NULL AND citations IS NOT NULL AND error_code IS NULL) OR (status<>'draft_ready' AND output IS NULL AND citations IS NULL))
);
CREATE INDEX agent_run_workspace_time ON app.agent_run(workspace_id,created_at DESC);
CREATE TABLE app.agent_step (
 workspace_id uuid NOT NULL, run_id uuid NOT NULL, ordinal integer NOT NULL CHECK(ordinal BETWEEN 1 AND 4),
 name text NOT NULL, status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','succeeded','failed','skipped')),
 started_at timestamptz, finished_at timestamptz, error_code text,
 PRIMARY KEY(run_id,ordinal), FOREIGN KEY(workspace_id,run_id) REFERENCES app.agent_run(workspace_id,id)
);
CREATE FUNCTION app.version_readable(p_workspace uuid,p_version uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT p_workspace=app.active_workspace() AND app.role_for(p_workspace) IS NOT NULL
 AND EXISTS(SELECT 1 FROM app.procedure_version WHERE workspace_id=p_workspace AND id=p_version)
 AND NOT EXISTS(SELECT 1 FROM app.procedure_source WHERE version_id=p_version AND NOT app.source_readable(p_workspace,source_id))
$$;
CREATE FUNCTION app.run_readable(p_workspace uuid,p_run uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM app.agent_run r JOIN app.agent_skill s ON s.workspace_id=r.workspace_id AND s.id=r.skill_id
 WHERE r.workspace_id=p_workspace AND r.id=p_run AND r.initiated_by=app.actor_id() AND app.version_readable(p_workspace,s.version_id))
$$;
ALTER TABLE app.procedure ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.procedure_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.procedure_source ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.agent_skill ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.agent_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.agent_step ENABLE ROW LEVEL SECURITY;
CREATE POLICY procedure_read ON app.procedure FOR SELECT TO companyos_app USING(
 EXISTS(SELECT 1 FROM app.procedure_version v WHERE v.procedure_id=app.procedure.id AND app.version_readable(app.procedure.workspace_id,v.id)));
CREATE POLICY version_read ON app.procedure_version FOR SELECT TO companyos_app USING(app.version_readable(workspace_id,id));
CREATE POLICY procedure_source_read ON app.procedure_source FOR SELECT TO companyos_app USING(app.version_readable(workspace_id,version_id));
CREATE POLICY skill_read ON app.agent_skill FOR SELECT TO companyos_app USING(app.version_readable(workspace_id,version_id));
CREATE POLICY run_read ON app.agent_run FOR SELECT TO companyos_app USING(app.run_readable(workspace_id,id));
CREATE POLICY step_read ON app.agent_step FOR SELECT TO companyos_app USING(app.run_readable(workspace_id,run_id));
GRANT SELECT ON app.procedure,app.procedure_version,app.procedure_source,app.agent_skill,app.agent_step TO companyos_app;
GRANT SELECT(id,workspace_id,skill_id,initiated_by,request_key,input,status,current_step,output,citations,error_code,engine,usage_kind,input_tokens,output_tokens,cost_microusd,deadline,created_at,started_at,finished_at) ON app.agent_run TO companyos_app;
ALTER TABLE app.audit_event DROP CONSTRAINT audit_event_action_check;
ALTER TABLE app.audit_event ADD CONSTRAINT audit_event_action_check CHECK(action IN (
 'workspace.created','workspace.updated','member.invited','member.joined','member.role_changed',
 'knowledge.created','knowledge.updated','document.uploaded','document.processed','document.accessed','knowledge.searched',
 'procedure.published','skill.created','skill.toggled','run.created','run.finished'
));
CREATE FUNCTION app.agent_authorize(p_workspace uuid,p_admin boolean DEFAULT false) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF p_workspace IS DISTINCT FROM app.active_workspace() OR app.role_for(p_workspace) IS NULL THEN RAISE EXCEPTION 'Workspace unavailable' USING ERRCODE='P0002'; END IF;
 IF p_admin AND app.role_for(p_workspace) NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Administrator required' USING ERRCODE='42501'; END IF;
END $$;
CREATE FUNCTION app.publish_procedure(p_workspace uuid,p_id uuid,p_title text,p_instructions text,p_sources uuid[]) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_id uuid:=p_id; v_version uuid; v_number integer;
BEGIN
 PERFORM app.agent_authorize(p_workspace,true);
 PERFORM 1 FROM app.workspace WHERE id=p_workspace FOR UPDATE;
 IF cardinality(p_sources) NOT BETWEEN 1 AND 8 OR p_sources IS NULL OR EXISTS(
 SELECT 1 FROM unnest(p_sources) source_id WHERE app.source_readable(p_workspace,source_id) IS DISTINCT FROM true) THEN RAISE EXCEPTION 'Source unavailable' USING ERRCODE='P0002'; END IF;
 IF p_id IS NULL THEN
 IF (SELECT count(*) FROM app.procedure WHERE workspace_id=p_workspace)>=50 THEN RAISE EXCEPTION 'Procedure limit' USING ERRCODE='54000'; END IF;
 INSERT INTO app.procedure(workspace_id,title,created_by) VALUES(p_workspace,p_title,app.actor_id()) RETURNING id INTO v_id;
 ELSE
 IF NOT EXISTS(SELECT 1 FROM app.procedure WHERE id=p_id AND workspace_id=p_workspace) OR
 EXISTS(SELECT 1 FROM app.procedure_version WHERE procedure_id=p_id AND NOT app.version_readable(p_workspace,id)) THEN RAISE EXCEPTION 'Procedure unavailable' USING ERRCODE='P0002'; END IF;
 UPDATE app.procedure SET title=p_title WHERE id=p_id;
 END IF;
 SELECT coalesce(max(version),0)+1 INTO v_number FROM app.procedure_version WHERE procedure_id=v_id;
 IF v_number>50 THEN RAISE EXCEPTION 'Version limit' USING ERRCODE='54000'; END IF;
 INSERT INTO app.procedure_version(workspace_id,procedure_id,version,title,instructions,created_by)
 VALUES(p_workspace,v_id,v_number,p_title,p_instructions,app.actor_id()) RETURNING id INTO v_version;
 INSERT INTO app.procedure_source(workspace_id,version_id,source_id) SELECT p_workspace,v_version,unnest(p_sources);
 INSERT INTO app.audit_event(workspace_id,actor_id,action,target) VALUES(p_workspace,app.actor_id(),'procedure.published',v_version::text);
 RETURN v_version;
END $$;
CREATE FUNCTION app.create_skill(p_workspace uuid,p_version uuid,p_name text,p_operation text,p_input jsonb,p_output jsonb,p_tokens integer,p_cost integer,p_timeout integer) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_id uuid;
BEGIN
 PERFORM app.agent_authorize(p_workspace,true);
 PERFORM 1 FROM app.workspace WHERE id=p_workspace FOR UPDATE;
 IF app.version_readable(p_workspace,p_version) IS DISTINCT FROM true THEN RAISE EXCEPTION 'Version unavailable' USING ERRCODE='P0002'; END IF;
 IF (SELECT count(*) FROM app.agent_skill WHERE workspace_id=p_workspace)>=100 THEN RAISE EXCEPTION 'Skill limit' USING ERRCODE='54000'; END IF;
 INSERT INTO app.agent_skill(workspace_id,version_id,name,operation,input_schema,output_schema,max_tokens,max_cost_microusd,timeout_ms,created_by)
 VALUES(p_workspace,p_version,p_name,p_operation,p_input,p_output,p_tokens,p_cost,p_timeout,app.actor_id()) RETURNING id INTO v_id;
 INSERT INTO app.audit_event(workspace_id,actor_id,action,target) VALUES(p_workspace,app.actor_id(),'skill.created',v_id::text);
 RETURN v_id;
END $$;
CREATE FUNCTION app.toggle_skill(p_workspace uuid,p_id uuid,p_enabled boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM app.agent_authorize(p_workspace,true);
 IF NOT EXISTS(SELECT 1 FROM app.agent_skill WHERE workspace_id=p_workspace AND id=p_id AND app.version_readable(p_workspace,version_id)) THEN RAISE EXCEPTION 'Skill unavailable' USING ERRCODE='P0002'; END IF;
 UPDATE app.agent_skill SET enabled=p_enabled WHERE id=p_id;
 INSERT INTO app.audit_event(workspace_id,actor_id,action,target) VALUES(p_workspace,app.actor_id(),'skill.toggled',p_id::text);
END $$;
CREATE FUNCTION app.create_agent_run(p_workspace uuid,p_skill uuid,p_key uuid,p_input jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_id uuid; v_existing app.agent_run;
BEGIN
 PERFORM app.agent_authorize(p_workspace);
 PERFORM 1 FROM app.workspace WHERE id=p_workspace FOR UPDATE;
 SELECT * INTO v_existing FROM app.agent_run WHERE workspace_id=p_workspace AND initiated_by=app.actor_id() AND request_key=p_key;
 IF FOUND THEN
 IF v_existing.skill_id<>p_skill OR v_existing.input<>p_input THEN RAISE EXCEPTION 'Idempotency conflict' USING ERRCODE='23505'; END IF;
 IF NOT app.run_readable(p_workspace,v_existing.id) THEN RAISE EXCEPTION 'Run unavailable' USING ERRCODE='P0002'; END IF;
 RETURN v_existing.id;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM app.agent_skill WHERE workspace_id=p_workspace AND id=p_skill AND enabled AND app.version_readable(p_workspace,version_id)) THEN RAISE EXCEPTION 'Skill unavailable' USING ERRCODE='P0002'; END IF;
 IF (SELECT count(*) FROM app.agent_run WHERE workspace_id=p_workspace)>=1000 OR
 (SELECT count(*) FROM app.agent_run WHERE workspace_id=p_workspace AND initiated_by=app.actor_id() AND created_at>now()-interval '1 minute')>=20 THEN RAISE EXCEPTION 'Run limit' USING ERRCODE='54000'; END IF;
 INSERT INTO app.agent_run(workspace_id,skill_id,initiated_by,request_key,input) VALUES(p_workspace,p_skill,app.actor_id(),p_key,p_input) RETURNING id INTO v_id;
 INSERT INTO app.agent_step(workspace_id,run_id,ordinal,name) VALUES
 (p_workspace,v_id,1,'Resolve sources'),(p_workspace,v_id,2,'Draft'),(p_workspace,v_id,3,'Validate output'),(p_workspace,v_id,4,'Enforce policy');
 INSERT INTO app.audit_event(workspace_id,actor_id,action,target) VALUES(p_workspace,app.actor_id(),'run.created',v_id::text);
 RETURN v_id;
END $$;
CREATE FUNCTION app.claim_agent_run(p_workspace uuid,p_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_run app.agent_run; v_skill app.agent_skill; v_token uuid:=gen_random_uuid();
BEGIN
 PERFORM app.agent_authorize(p_workspace);
 PERFORM 1 FROM app.workspace WHERE id=p_workspace FOR UPDATE;
 SELECT * INTO v_run FROM app.agent_run WHERE workspace_id=p_workspace AND id=p_id AND initiated_by=app.actor_id() FOR UPDATE;
 IF NOT FOUND OR NOT app.run_readable(p_workspace,p_id) THEN RAISE EXCEPTION 'Run unavailable' USING ERRCODE='P0002'; END IF;
 SELECT * INTO v_skill FROM app.agent_skill WHERE id=v_run.skill_id;
 IF v_run.status<>'queued' OR v_run.deadline<=now() OR NOT v_skill.enabled OR
 (SELECT count(*) FROM app.agent_run WHERE workspace_id=p_workspace AND status='running' AND deadline>now())>=3 THEN RAISE EXCEPTION 'Run conflict' USING ERRCODE='55000'; END IF;
 UPDATE app.agent_run SET status='running',lease=v_token,started_at=now(),deadline=now()+make_interval(secs=>v_skill.timeout_ms/1000.0+10) WHERE id=p_id;
 UPDATE app.agent_step SET status='running',started_at=now() WHERE run_id=p_id AND ordinal=1;
 RETURN v_token;
END $$;
CREATE FUNCTION app.advance_agent_run(p_workspace uuid,p_id uuid,p_token uuid,p_step integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_run app.agent_run;
BEGIN
 PERFORM app.agent_authorize(p_workspace);
 SELECT * INTO v_run FROM app.agent_run WHERE workspace_id=p_workspace AND id=p_id AND initiated_by=app.actor_id() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Run unavailable' USING ERRCODE='P0002'; END IF;
 IF v_run.status<>'running' OR v_run.lease IS DISTINCT FROM p_token OR v_run.deadline<=now() OR p_step<>v_run.current_step OR p_step NOT BETWEEN 1 AND 3 THEN RAISE EXCEPTION 'Run conflict' USING ERRCODE='55000'; END IF;
 IF NOT app.run_readable(p_workspace,p_id) THEN RAISE EXCEPTION 'Access changed' USING ERRCODE='42501'; END IF;
 UPDATE app.agent_step SET status='succeeded',finished_at=now() WHERE run_id=p_id AND ordinal=p_step;
 UPDATE app.agent_step SET status='running',started_at=now() WHERE run_id=p_id AND ordinal=p_step+1;
 UPDATE app.agent_run SET current_step=p_step+1 WHERE id=p_id;
END $$;
CREATE FUNCTION app.finish_agent_run(p_workspace uuid,p_id uuid,p_token uuid,p_error text,p_output jsonb,p_citations jsonb,p_usage jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_run app.agent_run; v_error text:=p_error; v_action jsonb;
BEGIN
 PERFORM app.agent_authorize(p_workspace);
 SELECT * INTO v_run FROM app.agent_run WHERE workspace_id=p_workspace AND id=p_id AND initiated_by=app.actor_id() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Run unavailable' USING ERRCODE='P0002'; END IF;
 IF v_run.status<>'running' OR v_run.lease IS DISTINCT FROM p_token THEN RAISE EXCEPTION 'Run conflict' USING ERRCODE='55000'; END IF;
 IF v_run.deadline<=now() THEN v_error:='timeout'; END IF;
 IF NOT app.run_readable(p_workspace,p_id) THEN v_error:='access_changed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM app.agent_skill WHERE id=v_run.skill_id AND enabled) THEN v_error:='access_changed'; END IF;
 IF v_error IS NULL THEN
 IF v_run.current_step<>4 OR p_output IS NULL OR p_citations IS NULL OR jsonb_typeof(p_output)<>'object' OR jsonb_typeof(p_citations)<>'array' OR jsonb_array_length(p_citations)=0 THEN RAISE EXCEPTION 'Invalid result' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM app.agent_skill s JOIN app.procedure_source ps ON ps.version_id=s.version_id JOIN app.knowledge_source ks ON ks.id=ps.source_id WHERE s.id=v_run.skill_id AND ks.archived) THEN v_error:='missing_sources'; END IF;
 FOR v_action IN SELECT * FROM jsonb_array_elements(p_output->'proposals') LOOP
 IF (v_action->>'approvalRequired') IS DISTINCT FROM 'true' OR (v_action->>'executionAllowed') IS DISTINCT FROM 'false' OR (v_action->>'state') IS DISTINCT FROM 'blocked' THEN RAISE EXCEPTION 'Execution forbidden' USING ERRCODE='42501'; END IF;
 END LOOP;
 END IF;
 UPDATE app.agent_run SET status=CASE WHEN v_error IS NULL THEN 'draft_ready' WHEN v_error='timeout' THEN 'timed_out' ELSE 'failed' END,
 error_code=v_error,output=CASE WHEN v_error IS NULL THEN p_output ELSE NULL END,citations=CASE WHEN v_error IS NULL THEN p_citations ELSE NULL END,
 engine=p_usage->>'engine',usage_kind=p_usage->>'kind',input_tokens=(p_usage->>'inputTokens')::integer,
 output_tokens=(p_usage->>'outputTokens')::integer,cost_microusd=(p_usage->>'costMicrousd')::bigint,lease=NULL,finished_at=now()
 WHERE id=p_id;
 UPDATE app.agent_step SET status=CASE WHEN v_error IS NULL THEN 'succeeded' ELSE 'failed' END,error_code=v_error,finished_at=now() WHERE run_id=p_id AND ordinal=v_run.current_step;
 UPDATE app.agent_step SET status='skipped',finished_at=now() WHERE run_id=p_id AND status='pending';
 INSERT INTO app.audit_event(workspace_id,actor_id,action,target) VALUES(p_workspace,app.actor_id(),'run.finished',p_id::text);
END $$;
CREATE FUNCTION app.expire_agent_runs(p_workspace uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_id uuid;
BEGIN
 PERFORM app.agent_authorize(p_workspace);
 FOR v_id IN UPDATE app.agent_run SET status='timed_out',error_code='timeout',lease=NULL,finished_at=now()
 WHERE workspace_id=p_workspace AND status IN ('queued','running') AND deadline<=now() RETURNING id LOOP
 UPDATE app.agent_step SET status=CASE WHEN status='running' OR ordinal=1 THEN 'failed' ELSE 'skipped' END,error_code='timeout',finished_at=now()
 WHERE run_id=v_id AND status IN ('pending','running');
 INSERT INTO app.audit_event(workspace_id,actor_id,action,target) VALUES(p_workspace,app.actor_id(),'run.finished',v_id::text);
 END LOOP;
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO companyos_app;

