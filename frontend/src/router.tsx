import { Navigate, createBrowserRouter } from "react-router"

import { AppShell, HomeRedirect, PublicOnly, RequireAdmin, RequireAuth } from "@/components/layout/app-shell"
import { WorkspaceLayout } from "@/components/layout/workspace-context"
import { AdminAuditPage } from "@/routes/admin/audit"
import { AdminBillingPage } from "@/routes/admin/billing"
import { AdminHealthPage } from "@/routes/admin/health"
import { AdminModelsPage } from "@/routes/admin/models"
import { AdminOverviewPage } from "@/routes/admin/overview"
import { AdminProvidersPage } from "@/routes/admin/providers"
import { AdminSettingsPage } from "@/routes/admin/settings"
import { AdminStatusPage } from "@/routes/admin/status"
import { AdminLogsPage, AdminUsagePage } from "@/routes/admin/usage"
import { AdminUserPage, AdminUsersPage } from "@/routes/admin/users"
import { AdminWorkspacePage, AdminWorkspacesPage } from "@/routes/admin/workspaces"
import { ApiKeysPage } from "@/routes/api-keys"
import { AuditPage } from "@/routes/audit"
import { CheckEmailPage, ConfirmEmailPage, ForgotPasswordPage, ResetPasswordPage, VerifyEmailPage } from "@/routes/auth/email-flows"
import { LoginPage, TwoFactorPage } from "@/routes/auth/login"
import { SignupPage } from "@/routes/auth/signup"
import { BillingPage } from "@/routes/billing"
import { DashboardPage } from "@/routes/dashboard"
import { InvitationsPage, NotificationsPage } from "@/routes/inbox"
import { MembersPage } from "@/routes/members"
import { NotFoundContent, NotFoundPage } from "@/routes/not-found"
import { OnboardingPage } from "@/routes/onboarding"
import { PlaygroundPage } from "@/routes/playground"
import { ProjectPage } from "@/routes/project"
import { ProjectsPage } from "@/routes/projects"
import { RolesPage } from "@/routes/roles"
import { NotificationsSection } from "@/routes/settings/account-extra"
import { SettingsLayout } from "@/routes/settings/layout"
import { AccountSection, AppearanceSection, ProfilePage, SecuritySection } from "@/routes/settings/sections"
import { LogsPage, UsagePage } from "@/routes/usage"
import { WorkspaceSettingsPage } from "@/routes/workspace-settings"

export const router = createBrowserRouter([
  {
    element: <PublicOnly />,
    children: [
      { path: "/login", element: <LoginPage /> },
      { path: "/login/2fa", element: <TwoFactorPage /> },
      { path: "/signup", element: <SignupPage /> },
      { path: "/check-email", element: <CheckEmailPage /> },
      { path: "/verify-email", element: <VerifyEmailPage /> },
      { path: "/forgot-password", element: <ForgotPasswordPage /> },
      { path: "/reset-password", element: <ResetPasswordPage /> },
    ],
  },
  { path: "/confirm-email", element: <ConfirmEmailPage /> },
  {
    element: <RequireAuth />,
    children: [
      { path: "/app", element: <HomeRedirect /> },
      { path: "/onboarding", element: <OnboardingPage /> },
      {
        element: <AppShell />,
        children: [
          {
            path: "/w/:workspaceId",
            element: <WorkspaceLayout />,
            children: [
              { index: true, element: <DashboardPage /> },
              { path: "playground", element: <PlaygroundPage /> },
              { path: "api-keys", element: <ApiKeysPage /> },
              { path: "projects", element: <ProjectsPage /> },
              { path: "projects/:projectId", element: <ProjectPage /> },
              { path: "usage", element: <UsagePage /> },
              { path: "logs", element: <LogsPage /> },
              { path: "activity", element: <AuditPage /> },
              { path: "billing", element: <BillingPage /> },
              { path: "members", element: <MembersPage /> },
              { path: "roles", element: <RolesPage /> },
              { path: "settings", element: <WorkspaceSettingsPage /> },
              { path: "*", element: <NotFoundContent /> },
            ],
          },
          {
            path: "/settings",
            element: <SettingsLayout />,
            children: [
              { index: true, element: <Navigate to="/settings/profile" replace /> },
              { path: "profile", element: <ProfilePage /> },
              { path: "security", element: <SecuritySection /> },
              { path: "notifications", element: <NotificationsSection /> },
              { path: "appearance", element: <AppearanceSection /> },
              { path: "account", element: <AccountSection /> },
            ],
          },
          { path: "/notifications", element: <NotificationsPage /> },
          { path: "/invitations", element: <InvitationsPage /> },
          {
            path: "/admin",
            element: <RequireAdmin />,
            children: [
              { index: true, element: <AdminOverviewPage /> },
              { path: "users", element: <AdminUsersPage /> },
              { path: "users/:userId", element: <AdminUserPage /> },
              { path: "workspaces", element: <AdminWorkspacesPage /> },
              { path: "workspaces/:workspaceId", element: <AdminWorkspacePage /> },
              { path: "models", element: <AdminModelsPage /> },
              { path: "providers", element: <AdminProvidersPage /> },
              { path: "health", element: <AdminHealthPage /> },
              { path: "billing", element: <AdminBillingPage /> },
              { path: "usage", element: <AdminUsagePage /> },
              { path: "logs", element: <AdminLogsPage /> },
              { path: "settings", element: <AdminSettingsPage /> },
              { path: "audit", element: <AdminAuditPage /> },
              { path: "status", element: <AdminStatusPage /> },
              { path: "*", element: <NotFoundContent /> },
            ],
          },
        ],
      },
    ],
  },
  { path: "*", element: <NotFoundPage /> },
])
