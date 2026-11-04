-- Better Auth core schema and separate least-privilege runtime roles.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE TABLE public."user" (
 id text PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE,
 "emailVerified" boolean NOT NULL DEFAULT false, image text,
 "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX user_email_normalized ON public."user"(lower(email));
CREATE TABLE public.session (
 id text PRIMARY KEY, "expiresAt" timestamptz NOT NULL, token text NOT NULL UNIQUE,
 "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now(),
 "ipAddress" text, "userAgent" text, "userId" text NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE
);
CREATE INDEX session_user_idx ON public.session("userId");
CREATE TABLE public.account (
 id text PRIMARY KEY, "accountId" text NOT NULL, "providerId" text NOT NULL,
 "userId" text NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
 "accessToken" text, "refreshToken" text, "idToken" text,
 "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz,
 scope text, password text, "createdAt" timestamptz NOT NULL DEFAULT now(),
 "updatedAt" timestamptz NOT NULL DEFAULT now(), UNIQUE("providerId","accountId")
);
CREATE INDEX account_user_idx ON public.account("userId");
CREATE TABLE public.verification (
 id text PRIMARY KEY, identifier text NOT NULL, value text NOT NULL,
 "expiresAt" timestamptz NOT NULL, "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX verification_identifier_idx ON public.verification(identifier);
CREATE TABLE public."rateLimit" (id text PRIMARY KEY, key text NOT NULL UNIQUE, count integer NOT NULL, "lastRequest" bigint NOT NULL);
GRANT USAGE ON SCHEMA public TO companyos_auth;
GRANT SELECT,INSERT,UPDATE,DELETE ON public."user",public.session,public.account,public.verification,public."rateLimit" TO companyos_auth;
CREATE SCHEMA app;
REVOKE ALL ON SCHEMA app FROM PUBLIC;
GRANT USAGE ON SCHEMA app TO companyos_app;
CREATE TABLE app.workspace (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 2 AND 80),
 industry text NOT NULL DEFAULT 'Digital agency' CHECK(length(btrim(industry)) BETWEEN 2 AND 80),
 timezone text NOT NULL DEFAULT 'UTC' CHECK(length(timezone) BETWEEN 1 AND 80),
 language text NOT NULL DEFAULT 'en' CHECK(language='en'),
 retention_days integer NOT NULL DEFAULT 90 CHECK(retention_days IN (30,90,365)),
 created_by text NOT NULL REFERENCES public."user"(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app.workspace_membership (
 workspace_id uuid NOT NULL REFERENCES app.workspace(id), user_id text NOT NULL REFERENCES public."user"(id),
 role text NOT NULL CHECK(role IN ('owner','admin','member')), joined_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,user_id)
);
CREATE UNIQUE INDEX one_owner_per_workspace ON app.workspace_membership(workspace_id) WHERE role='owner';
CREATE INDEX membership_user_idx ON app.workspace_membership(user_id,workspace_id);
CREATE TABLE app.invitation (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES app.workspace(id),
 email text NOT NULL CHECK(email=lower(email) AND length(email)<=254),
 role text NOT NULL CHECK(role IN ('admin','member')),
 token_hash text NOT NULL UNIQUE CHECK(token_hash ~ '^[a-f0-9]{64}$'),
 invited_by text NOT NULL REFERENCES public."user"(id), created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '7 days', accepted_at timestamptz,
 UNIQUE(workspace_id,email)
);
CREATE INDEX invitation_workspace_idx ON app.invitation(workspace_id);
CREATE TABLE app.audit_event (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES app.workspace(id),
 actor_id text NOT NULL REFERENCES public."user"(id), created_at timestamptz NOT NULL DEFAULT now(),
 action text NOT NULL CHECK(action IN ('workspace.created','workspace.updated','member.invited','member.joined','member.role_changed')),
 target text NOT NULL, result text NOT NULL DEFAULT 'success' CHECK(result='success'),
 risk text NOT NULL DEFAULT 'low' CHECK(risk IN ('low','medium')), metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX audit_workspace_time_idx ON app.audit_event(workspace_id,created_at DESC);
CREATE FUNCTION app.actor_id() RETURNS text LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT nullif(current_setting('app.user_id',true),'')
$$;
CREATE FUNCTION app.active_workspace() RETURNS uuid LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT nullif(current_setting('app.workspace_id',true),'')::uuid
$$;
-- Definer helpers avoid recursive policies; they have fixed search paths and no PUBLIC access.
CREATE FUNCTION app.role_for(p_workspace uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT role FROM app.workspace_membership WHERE workspace_id=p_workspace AND user_id=app.actor_id()
$$;
ALTER TABLE app.workspace ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.workspace_membership ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.invitation ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.audit_event ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_read ON app.workspace FOR SELECT TO companyos_app
 USING(app.role_for(id) IS NOT NULL AND (app.active_workspace() IS NULL OR id=app.active_workspace()));
CREATE POLICY membership_read ON app.workspace_membership FOR SELECT TO companyos_app
 USING((workspace_id=app.active_workspace() AND app.role_for(workspace_id) IS NOT NULL)
 OR (app.active_workspace() IS NULL AND user_id=app.actor_id()));
CREATE POLICY invitation_read ON app.invitation FOR SELECT TO companyos_app
 USING(workspace_id=app.active_workspace() AND app.role_for(workspace_id) IN ('owner','admin'));
CREATE POLICY audit_read ON app.audit_event FOR SELECT TO companyos_app
 USING(workspace_id=app.active_workspace() AND app.role_for(workspace_id) IN ('owner','admin'));
GRANT SELECT ON app.workspace,app.workspace_membership,app.audit_event TO companyos_app;
GRANT SELECT(id,workspace_id,email,role,invited_by,created_at,expires_at,accepted_at) ON app.invitation TO companyos_app;

CREATE FUNCTION app.create_workspace(p_name text,p_industry text,p_timezone text,p_language text,p_retention integer)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_id uuid;
BEGIN
 IF app.actor_id() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public."user" WHERE id=app.actor_id() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 IF (SELECT count(*) FROM app.workspace WHERE created_by=app.actor_id())>=10 THEN
 RAISE EXCEPTION 'Workspace limit reached' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=p_timezone) THEN
 RAISE EXCEPTION 'Invalid time zone' USING ERRCODE='22023'; END IF;
 INSERT INTO app.workspace(name,industry,timezone,language,retention_days,created_by)
 VALUES(btrim(p_name),btrim(p_industry),p_timezone,p_language,p_retention,app.actor_id()) RETURNING id INTO v_id;
 INSERT INTO app.workspace_membership(workspace_id,user_id,role) VALUES(v_id,app.actor_id(),'owner');
 INSERT INTO app.audit_event(workspace_id,actor_id,action,target) VALUES(v_id,app.actor_id(),'workspace.created',v_id::text);
 RETURN v_id;
END $$;
CREATE FUNCTION app.update_workspace(p_workspace uuid,p_name text,p_industry text,p_timezone text,p_language text,p_retention integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM 1 FROM app.workspace WHERE id=p_workspace FOR UPDATE;
 IF app.role_for(p_workspace) IS NULL OR app.role_for(p_workspace) NOT IN ('owner','admin') THEN
 RAISE EXCEPTION 'Administrator permission required' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_timezone_names WHERE name=p_timezone) THEN
 RAISE EXCEPTION 'Invalid time zone' USING ERRCODE='22023'; END IF;
 UPDATE app.workspace SET name=btrim(p_name),industry=btrim(p_industry),timezone=p_timezone,
 language=p_language,retention_days=p_retention,updated_at=now() WHERE id=p_workspace;
 INSERT INTO app.audit_event(workspace_id,actor_id,action,target) VALUES(p_workspace,app.actor_id(),'workspace.updated',p_workspace::text);
END $$;
CREATE FUNCTION app.member_directory(p_workspace uuid)
RETURNS TABLE(user_id text,name text,email text,role text,joined_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF app.role_for(p_workspace) IS NULL OR app.active_workspace() IS DISTINCT FROM p_workspace THEN
 RAISE EXCEPTION 'Workspace unavailable' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT m.user_id,u.name,u.email,m.role,m.joined_at
 FROM app.workspace_membership m JOIN public."user" u ON u.id=m.user_id
 WHERE m.workspace_id=p_workspace ORDER BY m.joined_at,m.user_id;
END $$;
CREATE FUNCTION app.invite_member(p_workspace uuid,p_email text,p_role text,p_hash text)
RETURNS TABLE(id uuid,expires_at timestamptz) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_role text;
BEGIN
 PERFORM 1 FROM app.workspace WHERE app.workspace.id=p_workspace FOR UPDATE;
 v_role:=app.role_for(p_workspace);
 IF v_role IS NULL OR v_role NOT IN ('owner','admin') OR (p_role='admin' AND v_role<>'owner') THEN
 RAISE EXCEPTION 'Invitation permission required' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM app.workspace_membership m JOIN public."user" u ON u.id=m.user_id
 WHERE m.workspace_id=p_workspace AND lower(u.email)=lower(p_email)) THEN
 RAISE EXCEPTION 'Already a member' USING ERRCODE='23505'; END IF;
 IF (SELECT count(*) FROM app.invitation i WHERE i.workspace_id=p_workspace AND i.accepted_at IS NULL AND i.expires_at>now())>=50 THEN
 RAISE EXCEPTION 'Invitation limit reached' USING ERRCODE='22023'; END IF;
 RETURN QUERY INSERT INTO app.invitation(workspace_id,email,role,token_hash,invited_by)
 VALUES(p_workspace,lower(p_email),p_role,p_hash,app.actor_id())
 ON CONFLICT(workspace_id,email) DO UPDATE SET role=EXCLUDED.role,token_hash=EXCLUDED.token_hash,
 invited_by=EXCLUDED.invited_by,created_at=now(),expires_at=now()+interval '7 days',accepted_at=NULL
 RETURNING app.invitation.id,app.invitation.expires_at;
 INSERT INTO app.audit_event(workspace_id,actor_id,action,target,risk)
 VALUES(p_workspace,app.actor_id(),'member.invited',p_workspace::text,'medium');
END $$;
CREATE FUNCTION app.accept_invitation(p_hash text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_inv app.invitation; v_email text; v_workspace uuid; v_issuer_role text;
BEGIN
 SELECT workspace_id INTO v_workspace FROM app.invitation WHERE token_hash=p_hash;
 IF v_workspace IS NULL THEN RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='P0002'; END IF;
 PERFORM 1 FROM app.workspace WHERE id=v_workspace FOR UPDATE;
 SELECT * INTO v_inv FROM app.invitation WHERE token_hash=p_hash FOR UPDATE;
 SELECT lower(email) INTO v_email FROM public."user" WHERE id=app.actor_id();
 IF v_email IS NULL OR v_email<>v_inv.email OR v_inv.expires_at<=now() OR v_inv.accepted_at IS NOT NULL THEN
 RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='P0002'; END IF;
 SELECT role INTO v_issuer_role FROM app.workspace_membership WHERE workspace_id=v_workspace AND user_id=v_inv.invited_by;
 IF v_issuer_role IS NULL OR v_issuer_role NOT IN ('owner','admin') OR (v_inv.role='admin' AND v_issuer_role<>'owner') THEN
 RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='P0002'; END IF;
 INSERT INTO app.workspace_membership(workspace_id,user_id,role) VALUES(v_workspace,app.actor_id(),v_inv.role);
 UPDATE app.invitation SET accepted_at=now() WHERE app.invitation.id=v_inv.id;
 INSERT INTO app.audit_event(workspace_id,actor_id,action,target) VALUES(v_workspace,app.actor_id(),'member.joined',app.actor_id());
 RETURN v_workspace;
END $$;
CREATE FUNCTION app.change_member_role(p_workspace uuid,p_user text,p_role text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE v_previous text;
BEGIN
 PERFORM 1 FROM app.workspace WHERE id=p_workspace FOR UPDATE;
 IF app.role_for(p_workspace) IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'Owner required' USING ERRCODE='42501'; END IF;
 SELECT role INTO v_previous FROM app.workspace_membership WHERE workspace_id=p_workspace AND user_id=p_user FOR UPDATE;
 IF v_previous IS NULL THEN RAISE EXCEPTION 'Member unavailable' USING ERRCODE='P0002'; END IF;
 IF v_previous='owner' OR p_role NOT IN ('admin','member') OR p_role IS NULL THEN
 RAISE EXCEPTION 'Owner role cannot change' USING ERRCODE='42501'; END IF;
 UPDATE app.workspace_membership SET role=p_role WHERE workspace_id=p_workspace AND user_id=p_user;
 INSERT INTO app.audit_event(workspace_id,actor_id,action,target,risk,metadata)
 VALUES(p_workspace,app.actor_id(),'member.role_changed',p_user,'medium',jsonb_build_object('previousRole',v_previous,'role',p_role));
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO companyos_app;
