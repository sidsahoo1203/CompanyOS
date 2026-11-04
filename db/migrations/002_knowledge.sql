CREATE TABLE app.knowledge_source (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES app.workspace(id),
 owner_id text NOT NULL REFERENCES public."user"(id),
 title text NOT NULL CHECK(length(btrim(title)) BETWEEN 2 AND 120),
 description text NOT NULL DEFAULT '' CHECK(length(description)<=1000),
 tags text[] NOT NULL DEFAULT '{}' CHECK(cardinality(tags)<=10),
 scope text NOT NULL DEFAULT 'workspace' CHECK(scope IN ('workspace','admins','private')),
 archived boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,id)
);
CREATE INDEX source_workspace_idx ON app.knowledge_source(workspace_id);
CREATE TABLE app.document (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL,
 source_id uuid NOT NULL, uploaded_by text NOT NULL REFERENCES public."user"(id),
 filename text NOT NULL CHECK(length(filename) BETWEEN 1 AND 160),
 media_type text NOT NULL, byte_size integer NOT NULL CHECK(byte_size BETWEEN 1 AND 5242880),
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 payload bytea NOT NULL CHECK(octet_length(payload)=byte_size),
 version integer NOT NULL CHECK(version>0),
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','processing','ready','failed','quarantined')),
 error_code text, scanner text, lease uuid, lease_until timestamptz,
 chunk_count integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(), processed_at timestamptz,
 FOREIGN KEY(workspace_id,source_id) REFERENCES app.knowledge_source(workspace_id,id),
 UNIQUE(workspace_id,id), UNIQUE(source_id,filename,version)
);
CREATE INDEX document_source_idx ON app.document(workspace_id,source_id,filename,version DESC);
CREATE TABLE app.document_chunk (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL,
 document_id uuid NOT NULL, ordinal integer NOT NULL CHECK(ordinal BETWEEN 1 AND 500),
 location text NOT NULL CHECK(length(location)<=120),
 content text NOT NULL CHECK(length(content) BETWEEN 1 AND 2000),
 search_vector tsvector GENERATED ALWAYS AS (to_tsvector('english',content)) STORED,
 FOREIGN KEY(workspace_id,document_id) REFERENCES app.document(workspace_id,id),
 UNIQUE(document_id,ordinal)
);
CREATE INDEX chunk_document_idx ON app.document_chunk(workspace_id,document_id);
CREATE INDEX chunk_search_idx ON app.document_chunk USING gin(search_vector);
CREATE TABLE app.knowledge_rate (
 workspace_id uuid NOT NULL REFERENCES app.workspace(id), user_id text NOT NULL REFERENCES public."user"(id),
 operation text NOT NULL, window_at timestamptz NOT NULL, count integer NOT NULL,
 PRIMARY KEY(workspace_id,user_id,operation)
);
ALTER TABLE app.audit_event DROP CONSTRAINT audit_event_action_check;
ALTER TABLE app.audit_event ADD CONSTRAINT audit_event_action_check CHECK(action IN (
 'workspace.created','workspace.updated','member.invited','member.joined','member.role_changed',
 'knowledge.created','knowledge.updated','document.uploaded','document.processed','document.accessed','knowledge.searched'
));
CREATE FUNCTION app.source_readable(p_workspace uuid,p_source uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT p_workspace=app.active_workspace() AND app.role_for(p_workspace) IS NOT NULL AND EXISTS(
 SELECT 1 FROM app.knowledge_source s WHERE s.workspace_id=p_workspace AND s.id=p_source
 AND (s.scope='workspace' OR (s.scope='admins' AND app.role_for(p_workspace) IN ('owner','admin'))
 OR (s.scope='private' AND s.owner_id=app.actor_id())))
$$;
CREATE FUNCTION app.document_readable(p_workspace uuid,p_document uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM app.document d WHERE d.workspace_id=p_workspace AND d.id=p_document
 AND app.source_readable(p_workspace,d.source_id))
$$;
ALTER TABLE app.knowledge_source ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.document ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.document_chunk ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.knowledge_rate ENABLE ROW LEVEL SECURITY;
CREATE POLICY source_read ON app.knowledge_source FOR SELECT TO companyos_app
 USING(app.source_readable(workspace_id,id));
CREATE POLICY document_read ON app.document FOR SELECT TO companyos_app
 USING(app.source_readable(workspace_id,source_id));
CREATE POLICY chunk_read ON app.document_chunk FOR SELECT TO companyos_app
 USING(app.document_readable(workspace_id,document_id));
GRANT SELECT ON app.knowledge_source,app.document_chunk TO companyos_app;
GRANT SELECT(id,workspace_id,source_id,uploaded_by,filename,media_type,byte_size,sha256,version,status,
 error_code,scanner,chunk_count,created_at,processed_at) ON app.document TO companyos_app;

CREATE FUNCTION app.require_source_admin(p_workspace uuid,p_source uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF app.source_readable(p_workspace,p_source) IS DISTINCT FROM true THEN
 RAISE EXCEPTION 'Source unavailable' USING ERRCODE='P0002'; END IF;
 IF app.role_for(p_workspace) NOT IN ('owner','admin') THEN
 RAISE EXCEPTION 'Administrator required' USING ERRCODE='42501'; END IF;
END $$;

CREATE FUNCTION app.knowledge_limit(p_workspace uuid,p_operation text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_count integer;
BEGIN
 IF p_workspace IS DISTINCT FROM app.active_workspace() OR app.role_for(p_workspace) IS NULL
 OR p_operation NOT IN ('upload','search','answer') THEN RAISE EXCEPTION 'Denied' USING ERRCODE='42501'; END IF;
 INSERT INTO app.knowledge_rate(workspace_id,user_id,operation,window_at,count)
 VALUES(p_workspace,app.actor_id(),p_operation,date_trunc('minute',now()),1)
 ON CONFLICT(workspace_id,user_id,operation) DO UPDATE
 SET count=CASE WHEN app.knowledge_rate.window_at=date_trunc('minute',now()) THEN app.knowledge_rate.count+1 ELSE 1 END,
 window_at=date_trunc('minute',now()) RETURNING count INTO v_count;
 IF v_count>(CASE WHEN p_operation='upload' THEN 20 ELSE 60 END) THEN
 RAISE EXCEPTION 'Rate limit reached' USING ERRCODE='54000'; END IF;
END $$;

CREATE FUNCTION app.save_source(p_workspace uuid,p_id uuid,p_title text,p_description text,p_tags text[],p_scope text,p_archived boolean)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_id uuid:=p_id;
BEGIN
 IF p_workspace IS DISTINCT FROM app.active_workspace() OR app.role_for(p_workspace) IS NULL THEN
 RAISE EXCEPTION 'Workspace unavailable' USING ERRCODE='P0002'; END IF;
 IF app.role_for(p_workspace) NOT IN ('owner','admin') THEN RAISE EXCEPTION 'Administrator required' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM app.workspace WHERE id=p_workspace FOR UPDATE;
 IF p_id IS NULL THEN
 IF (SELECT count(*) FROM app.knowledge_source WHERE workspace_id=p_workspace)>=50 THEN
 RAISE EXCEPTION 'Source limit reached' USING ERRCODE='54000'; END IF;
 INSERT INTO app.knowledge_source(workspace_id,owner_id,title,description,tags,scope,archived)
 VALUES(p_workspace,app.actor_id(),p_title,p_description,p_tags,p_scope,p_archived) RETURNING id INTO v_id;
 ELSE
 PERFORM app.require_source_admin(p_workspace,p_id);
 -- Only the creator can turn a shared source private, to prevent losing their own access.
 IF p_scope='private' AND NOT EXISTS(SELECT 1 FROM app.knowledge_source WHERE id=p_id AND owner_id=app.actor_id()) THEN
 RAISE EXCEPTION 'Creator required for private scope' USING ERRCODE='42501'; END IF;
 UPDATE app.knowledge_source SET title=p_title,description=p_description,tags=p_tags,scope=p_scope,archived=p_archived,updated_at=now() WHERE id=p_id;
 END IF;
 INSERT INTO app.audit_event(workspace_id,actor_id,action,target) VALUES(p_workspace,app.actor_id(),CASE WHEN p_id IS NULL THEN 'knowledge.created' ELSE 'knowledge.updated' END,v_id::text);
 RETURN v_id;
END $$;

CREATE FUNCTION app.store_document(p_workspace uuid,p_source uuid,p_filename text,p_media text,p_payload bytea,p_hash text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_id uuid; v_version integer;
BEGIN
 PERFORM 1 FROM app.workspace WHERE id=p_workspace FOR UPDATE;
 PERFORM app.require_source_admin(p_workspace,p_source);
 IF EXISTS(SELECT 1 FROM app.knowledge_source WHERE id=p_source AND archived) THEN
 RAISE EXCEPTION 'Source is archived' USING ERRCODE='22023'; END IF;
 IF p_filename ~ '[/\\]' OR p_filename LIKE '%..%' OR p_filename ~ '[[:cntrl:]]' THEN
 RAISE EXCEPTION 'Invalid filename' USING ERRCODE='22023'; END IF;
 IF (SELECT count(*) FROM app.document WHERE workspace_id=p_workspace)>=100 OR
 (SELECT coalesce(sum(byte_size),0) FROM app.document WHERE workspace_id=p_workspace)+octet_length(p_payload)>52428800 THEN
 RAISE EXCEPTION 'Storage limit reached' USING ERRCODE='54000'; END IF;
 SELECT coalesce(max(version),0)+1 INTO v_version FROM app.document WHERE source_id=p_source AND filename=p_filename;
 INSERT INTO app.document(workspace_id,source_id,uploaded_by,filename,media_type,byte_size,sha256,payload,version)
 VALUES(p_workspace,p_source,app.actor_id(),p_filename,p_media,octet_length(p_payload),p_hash,p_payload,v_version) RETURNING id INTO v_id;
 INSERT INTO app.audit_event(workspace_id,actor_id,action,target) VALUES(p_workspace,app.actor_id(),'document.uploaded',v_id::text);
 RETURN v_id;
END $$;

CREATE FUNCTION app.claim_document(p_workspace uuid,p_id uuid) RETURNS TABLE(token uuid,payload bytea,filename text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_doc app.document; v_token uuid:=gen_random_uuid();
BEGIN
 PERFORM 1 FROM app.workspace WHERE id=p_workspace FOR UPDATE;
 SELECT * INTO v_doc FROM app.document WHERE workspace_id=p_workspace AND id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Document unavailable' USING ERRCODE='P0002'; END IF;
 PERFORM app.require_source_admin(p_workspace,v_doc.source_id);
 IF EXISTS(SELECT 1 FROM app.knowledge_source WHERE id=v_doc.source_id AND archived) THEN
 RAISE EXCEPTION 'Source is archived' USING ERRCODE='22023'; END IF;
 IF v_doc.status='ready' OR (v_doc.status='processing' AND v_doc.lease_until>now()) OR
 (SELECT count(*) FROM app.document WHERE workspace_id=p_workspace AND status='processing' AND lease_until>now())>=3 THEN
 RAISE EXCEPTION 'Processing conflict' USING ERRCODE='55000'; END IF;
 UPDATE app.document SET status='processing',error_code=NULL,lease=v_token,lease_until=now()+interval '30 seconds' WHERE id=p_id;
 RETURN QUERY SELECT v_token,v_doc.payload,v_doc.filename;
END $$;

CREATE FUNCTION app.finish_document(p_workspace uuid,p_id uuid,p_token uuid,p_status text,p_error text,p_scanner text,p_chunks jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_doc app.document; v_chunk jsonb; v_ordinal integer:=0;
BEGIN
 SELECT * INTO v_doc FROM app.document WHERE workspace_id=p_workspace AND id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Document unavailable' USING ERRCODE='P0002'; END IF;
 PERFORM app.require_source_admin(p_workspace,v_doc.source_id);
 IF v_doc.status<>'processing' OR v_doc.lease IS DISTINCT FROM p_token OR v_doc.lease_until<=now() THEN
 RAISE EXCEPTION 'Processing lease expired' USING ERRCODE='55000'; END IF;
 IF p_status NOT IN ('ready','failed','quarantined') OR jsonb_typeof(p_chunks)<>'array' OR jsonb_array_length(p_chunks)>500
 OR (p_status='ready' AND jsonb_array_length(p_chunks)=0) OR (p_status<>'ready' AND jsonb_array_length(p_chunks)>0) THEN
 RAISE EXCEPTION 'Invalid processing output' USING ERRCODE='22023'; END IF;
 -- Version content is only written once on a successful transition.
 FOR v_chunk IN SELECT * FROM jsonb_array_elements(p_chunks) LOOP
 v_ordinal:=v_ordinal+1;
 INSERT INTO app.document_chunk(workspace_id,document_id,ordinal,location,content)
 VALUES(p_workspace,p_id,v_ordinal,v_chunk->>'location',v_chunk->>'content');
 END LOOP;
 UPDATE app.document SET status=p_status,error_code=p_error,scanner=p_scanner,lease=NULL,lease_until=NULL,
 chunk_count=v_ordinal,processed_at=now() WHERE id=p_id;
 INSERT INTO app.audit_event(workspace_id,actor_id,action,target) VALUES(p_workspace,app.actor_id(),'document.processed',p_id::text);
END $$;
CREATE FUNCTION app.knowledge_event(p_workspace uuid,p_document uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF app.document_readable(p_workspace,p_document) IS DISTINCT FROM true THEN RAISE EXCEPTION 'Document unavailable' USING ERRCODE='P0002'; END IF;
 INSERT INTO app.audit_event(workspace_id,actor_id,action,target) VALUES(p_workspace,app.actor_id(),'document.accessed',p_document::text);
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO companyos_app;

