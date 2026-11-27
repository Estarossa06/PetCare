import { createDiagnosticErrorBoundary } from "../../src/diagnostics/DiagnosticErrorBoundary";
import CalendarScreen from "../../src/features/calendar/screens/CalendarScreen";

export default function CalendarRoute() {
  return <CalendarScreen />;
}

export const ErrorBoundary = createDiagnosticErrorBoundary("calendar");
