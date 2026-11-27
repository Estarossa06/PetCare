import { createDiagnosticErrorBoundary } from "../../src/diagnostics/DiagnosticErrorBoundary";
import KiraiScreen from "../../src/features/kirai/screens/KiraiScreen";

export default function AssistantRoute() {
  return <KiraiScreen />;
}

export const ErrorBoundary = createDiagnosticErrorBoundary("kirai");
