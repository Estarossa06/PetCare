import { useLocalSearchParams } from "expo-router";
import CareFormScreen from "../../../../../src/features/care/screens/CareFormScreen";

export default function EditCareTaskRoute() {
  const { id, taskId } = useLocalSearchParams<{ id: string; taskId: string }>();
  return <CareFormScreen petId={id} taskId={taskId} />;
}
