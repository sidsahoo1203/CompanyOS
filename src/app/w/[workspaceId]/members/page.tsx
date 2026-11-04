import { workspacePage } from "@/lib/page-session";
import { can, canRemove } from "@/lib/permissions";
import {
  InviteForm,
  RemoveControl,
  RoleControl,
} from "@/components/member-controls";
export const metadata = { title: "Members" };
export default async function Members({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const { session, workspace, members, invitations } =
    await workspacePage(workspaceId);
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">PEOPLE & ACCESS</p>
          <h1>Your team</h1>
          <p className="muted">Clear roles for everyone in {workspace.name}.</p>
        </div>
        <span className="badge">
          {members.length} {members.length === 1 ? "member" : "members"}
        </span>
      </div>
      <section className="panel">
        <h2>Workspace members</h2>
        <div
          className="table-scroll"
          role="region"
          aria-label="Workspace member table"
          tabIndex={0}
        >
          <table>
            <caption className="sr-only">
              Members and their access roles
            </caption>
            <thead>
              <tr>
                <th scope="col">Person</th>
                <th scope="col">Role</th>
                <th scope="col">Manage access</th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr key={member.user_id}>
                  <td>
                    <strong>{member.name}</strong>
                    <span className="table-secondary">{member.email}</span>
                  </td>
                  <td>
                    <span className="badge">{member.role}</span>
                  </td>
                  <td>
                    {can(workspace.role, "members:roles") &&
                    member.role !== "owner" ? (
                      <RoleControl
                        workspaceId={workspaceId}
                        userId={member.user_id}
                        name={member.name}
                        role={member.role}
                      />
                    ) : (
                      <span className="hint">
                        {member.role === "owner"
                          ? "Workspace owner"
                          : "Owner managed"}
                      </span>
                    )}
                    {canRemove(
                      workspace.role,
                      member.role,
                      member.user_id === session.user.id,
                    ) && (
                      <RemoveControl
                        workspaceId={workspaceId}
                        userId={member.user_id}
                        name={member.name}
                        self={member.user_id === session.user.id}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="hint">
          Owners manage roles and can remove anyone else. Admins manage
          settings, invite and remove members. Anyone except the owner can
          leave. Owner transfer is not available yet.
        </p>
      </section>
      {can(workspace.role, "members:invite") ? (
        <section className="panel">
          <h2>Invite a teammate</h2>
          <InviteForm
            workspaceId={workspaceId}
            owner={workspace.role === "owner"}
          />
        </section>
      ) : (
        <p className="notice">
          Ask your owner or an admin to invite teammates.
        </p>
      )}
      {can(workspace.role, "members:invite") && (
        <section className="panel">
          <h2>Pending invitations</h2>
          {invitations.length ? (
            <ul className="invitation-list">
              {invitations.map((invite) => (
                <li key={invite.id}>
                  <div>
                    <strong>{invite.email}</strong>
                    <span className="table-secondary">
                      Expires{" "}
                      {new Intl.DateTimeFormat("en", {
                        dateStyle: "medium",
                        timeZone: workspace.timezone,
                      }).format(invite.expires_at)}
                    </span>
                  </div>
                  <span className="badge">{invite.role}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">
              No active invitations. Create a link above when you’re ready.
            </p>
          )}
        </section>
      )}
    </>
  );
}
