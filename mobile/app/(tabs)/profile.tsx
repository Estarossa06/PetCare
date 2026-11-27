import { createDiagnosticErrorBoundary } from "../../src/diagnostics/DiagnosticErrorBoundary";
import ProfileScreen from "../../src/features/profile/screens/ProfileScreen";

export default function ProfileRoute() {
  return <ProfileScreen />;
}

export const ErrorBoundary = createDiagnosticErrorBoundary("profile");
