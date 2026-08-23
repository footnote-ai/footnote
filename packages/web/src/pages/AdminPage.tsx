/**
 * @description: Provides the signed-in administrator entry point for the existing backend-owned settings editor.
 * @footnote-scope: web
 * @footnote-module: AdminPage
 * @footnote-risk: high - Route presentation must not be mistaken for backend authorization.
 * @footnote-ethics: high - The page exposes governance-sensitive settings only through backend-owned checks.
 */

import SetupPage from './SetupPage';

/** The backend remains authoritative; this page only selects the account-session editor mode. */
const AdminPage = (): JSX.Element => <SetupPage mode="admin" />;

export default AdminPage;
