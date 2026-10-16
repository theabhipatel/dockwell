This page covers everything about working together in DockWell: workspaces, projects, members, invitations, roles and permissions, plus the activity log, notifications, playground, usage and logs, and your own account security.

## Workspaces

A workspace is your team or organisation. Credits, billing, limits, members and projects all belong to it.

- You can belong to **many workspaces** and switch between them with the **workspace switcher** at the top of the sidebar.
- One of them is your **default workspace**, the one you land in after signing in. You can change it from the switcher.
- You can **own up to 20 workspaces**. Create one from the switcher with **New workspace**. Additional workspaces don't receive the starter credit.

### Workspace settings

Members with **Manage workspace settings** can change:

| Setting | Notes |
|---|---|
| Name and slug | The slug is the workspace's short, URL-friendly name. |
| Logo | Shown in the switcher and sidebar. |
| Default project | Used by the playground when no project is picked. |
| Log retention | Keep request logs for fewer days than the platform's retention. |
| Store prompts and responses | Opt out of prompt logging even when the platform allows it. See [Request logs](#request-logs). |

## Projects

Projects group API keys, usage and limits inside a workspace. See [Core concepts](/docs/core-concepts#projects).

- Members with **Create projects** can create them.
- Members with **Edit and delete projects** can rename, archive, unarchive and delete projects they can access, and set each project's RPM, TPM and monthly spend limits.
- The **Default project** can't be deleted. Deleting any other project stops all of its keys.
- Archiving a project stops its keys until it's unarchived.

### Project access

Members only see the projects they're **assigned to**, unless their role has **Access all projects**. Members with **Manage project access** choose who is assigned to a project, from the project's **Members** tab or from a member's row on the **Members** page. You can also pick projects when you invite someone.

## Members and invitations

### Inviting people

1. In the sidebar, select **Members**, then **Invite**.
2. Enter the person's **email address**.
3. Choose a **role**. You can only offer roles ranked below your own, whose permissions you hold yourself.
4. Optionally pick the **projects** they should see.
5. Select **Send invitation**.

The person gets an email. They can accept or decline from the email or from the **inbox** in the app. An invitation:

- is tied to the invited **email address**: they must sign in (or sign up) with that address;
- requires a **verified email** before it can be accepted;
- **expires** after 7 days by default (`INVITATION_TTL_DAYS`);
- can be **resent**, at most once a minute, which also refreshes its expiry;
- can be **revoked** before it's accepted.

Pending invitations are listed on the **Members** page with who sent them, when and when they expire.

### Managing members

| Action | Who can do it |
|---|---|
| Change a member's role | Members with **Change member roles**, for members ranked below them, to roles ranked below them |
| Remove a member | Members with **Remove members**, for members ranked below them |
| Leave a workspace | Anyone except the Owner |
| Transfer ownership | The Owner only |
| Delete the workspace | The Owner only |

### Transferring ownership

1. Open **Settings** for the workspace and select **Transfer ownership**.
2. Choose the new owner. They must already be a member.
3. Type the workspace name to confirm.

The new owner gets the **Owner** role and a notification. You become an **Admin**. The Owner can't leave a workspace, so transfer ownership first if you want to leave.

### Deleting a workspace

The Owner can delete a workspace from **Settings** by typing its name. Projects, keys, members and any remaining credit go with it, and every member is notified. If requests are still running, DockWell asks you to try again in a minute.

## Roles

Every member has exactly one role. Each workspace starts with four built-in roles:

| Role | Rank | Summary |
|---|---|---|
| **Owner** | 1000 | Full control. Exactly one per workspace. Can't be edited or assigned, only transferred. |
| **Admin** | 900 | Every permission. Manages everything and everyone except the Owner and other Admins. |
| **Manager** | 500 | Runs the projects they're assigned to: keys, usage, logs, project access, and can invite. |
| **Member** | 100 | Creates their own keys in assigned projects, views usage and uses the playground. |

### Custom roles

Members with **Manage roles** can create roles with any set of permissions, for example a "Finance" role that can only view and manage billing:

1. Open **Roles** and select **New role**.
2. Enter a name and description, and tick the permissions.
3. Choose where it sits in the ranking (below which role).
4. Select **Create role**.

Built-in roles other than Owner can be edited too. When you delete a role that members still have, you pick a replacement role for them.

### Ranking rules

Ranks decide who can manage whom. The rules are simple and enforced on the server:

- You can only manage members, invitations and roles **ranked strictly below your own**. Admins can't manage other Admins.
- You can only assign or invite with a role **ranked below yours** whose permissions **you hold yourself**.
- You can only grant or remove permissions on a role that **you hold yourself**.
- You can only place roles **below your own** in the ranking.
- The **Owner** is exempt from these rules but can't be managed by anyone. Ownership is only ever **transferred**, never assigned.

## Permissions

The full permission catalogue, with what each built-in role gets:

| Group | Permission | Key | What it allows | Owner | Admin | Manager | Member |
|---|---|---|---|---|---|---|---|
| Workspace | Manage workspace settings | `workspace.manage_settings` | Rename the workspace, change its slug, logo, default project and data retention. | Yes | Yes | | |
| Members | Invite members | `members.invite` | Invite people by email with a role ranked below their own, and manage invitations. | Yes | Yes | Yes | |
| Members | Remove members | `members.remove` | Remove members ranked below them. | Yes | Yes | | |
| Members | Change member roles | `members.change_role` | Change the role of members ranked below them. | Yes | Yes | | |
| Members | Manage roles | `roles.manage` | Create, edit and delete roles ranked below their own. | Yes | Yes | | |
| Billing | Manage billing and add credits | `billing.manage` | Buy credits, set spend limits, alerts, auto recharge and billing details. | Yes | Yes | | |
| Billing | View billing | `billing.view` | See the balance, credit ledger, payments and invoices. | Yes | Yes | Yes | |
| Projects | Access all projects | `projects.access_all` | See every project, not only the ones they're assigned to. | Yes | Yes | | |
| Projects | Create projects | `projects.create` | Create new projects. | Yes | Yes | Yes | |
| Projects | Edit and delete projects | `projects.manage` | Rename, archive, delete and set limits on projects they can access. | Yes | Yes | Yes | |
| Projects | Manage project access | `projects.manage_members` | Choose which members can see the projects they can access. | Yes | Yes | Yes | |
| API keys | Manage all API keys | `keys.manage_all` | Create, revoke and delete any key in projects they can access. | Yes | Yes | Yes | |
| API keys | Manage own API keys | `keys.manage_own` | Create keys in projects they can access, and revoke or delete their own keys. | Yes | Yes | | Yes |
| Usage | View usage | `usage.view` | See usage charts and export usage as CSV. | Yes | Yes | Yes | Yes |
| Usage | View request logs | `logs.view` | See request logs and their details. | Yes | Yes | Yes | |
| Usage | View activity log | `audit.view` | See and export the workspace activity log. | Yes | Yes | | |
| Playground | Use the playground | `playground.use` | Chat with models in the playground, charged to the workspace. | Yes | Yes | Yes | Yes |

## Activity log

The **Activity** page is an append-only record of who did what in the workspace: sign-ins, keys created and revoked, members invited and removed, role changes, credits added, settings changed and more. Each entry shows the member, the action, the target, the result, the IP address and the device.

You can filter by member, action and date range, and export to CSV. It's visible to the Owner and anyone with **View activity log**.

## Notifications

The bell icon opens your **inbox** of in-app notifications: invitations, low and zero balance, payments succeeded or failed, spend alerts, keys about to expire, models being deprecated and more.

Important notifications are also emailed. Under **Account settings > Notifications**, you can turn off email for each category:

| Category | Covers |
|---|---|
| Billing | Payments, low and zero balance, auto recharge. |
| Spend alerts | Monthly spend threshold and limit reached. |
| API keys | Keys that are about to expire. |
| Models | Models being deprecated or retired. |
| Workspace | Invitations, role changes and membership. |

**Security emails** (new sign-ins, password changes, two-factor changes) are always sent and can't be turned off.

## Playground

Members with **Use the playground** can chat with any model available to the workspace:

- pick a model in the picker inside the chat input, which shows price and context length;
- set a system prompt, temperature, max tokens, top p, frequency and presence penalties, stop sequences and a seed;
- replies stream with a stop button, and can be regenerated and copied;
- every reply shows its tokens and **cost**;
- **View code** shows the same request as curl, Python and JavaScript.

Playground usage is **charged to the workspace**, to the project you choose or the default project, at the model's price. Conversations are saved per user: only you see yours.

## Usage

The **Usage** page (permission **View usage**) shows charts of requests, input and output tokens, and cost over time. You can:

- **filter** by date range, project, API key, model, member and source (API or playground);
- **group** by model, project, API key, member or source;
- **export** the data as CSV.

The dashboard also shows the balance, spend this month, requests and tokens today and this month, top models and recent activity.

## Request logs

The **Logs** page (permission **View request logs**) lists every request: time, project, key, model, input and output tokens, cost, latency, time to first token, status (success, error or cancelled), error message and source. You can filter by the same fields as usage plus status, search, and open a request for details.

### Is prompt content stored?

**Not by default.** Prompt and response content is stored only when **both** of these are true:

1. The platform admin has turned on **prompt logging** for the install (off by default).
2. Your workspace hasn't opted out under **Settings > Store prompts and responses**.

When content isn't stored, the log still records tokens, cost, timing and status, never the text.

Logs are deleted after the platform's retention period (30 days by default). A workspace can choose a shorter retention in its settings.

## Account security

Your account settings cover your profile (name, picture, email address), password, theme and the security features below.

### Two-factor authentication

Turn on two-factor authentication under **Account settings > Security**:

1. Select **Set up two-factor authentication**.
2. Scan the QR code with an authenticator app (Google Authenticator, 1Password, Authy and others), or enter the secret by hand.
3. Enter the 6-digit code to confirm.
4. Save the **10 backup codes** somewhere safe. Each works once, in place of a code from the app.

From then on, signing in asks for a code after your password. You can generate new backup codes (which replaces the old ones) or turn two-factor off with a valid code. If you lose both your app and your backup codes, a platform admin can reset two-factor for you.

### Sessions

The **Sessions** list shows every device signed in to your account, with its browser, IP address and last activity. You can sign out one session or **all other sessions**. Changing your password signs out your other sessions automatically.

Sessions expire after 30 days, or after 7 days without use (`SESSION_TTL_DAYS`, `SESSION_IDLE_DAYS`).

### Google sign-in

If the platform has Google sign-in enabled, you can **link** Google to your account and then sign in with either method. You can **unlink** it later, but only if your account has a password, so you can still sign in.

### Sign-in protection

After 5 failed sign-ins for an address within 15 minutes, further attempts are refused until the window passes. Changing your email address requires confirming the new address by email.

### Deleting your account

You can delete your account from **Account settings**. If you own workspaces that have other members, transfer ownership or remove those members first.
