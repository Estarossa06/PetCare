import { createDiagnosticErrorBoundary } from "../../src/diagnostics/DiagnosticErrorBoundary";
import PetListScreen from "../../src/features/pets/screens/PetListScreen";

export default function PetsRoute() {
  return <PetListScreen />;
}

export const ErrorBoundary = createDiagnosticErrorBoundary("pets");
