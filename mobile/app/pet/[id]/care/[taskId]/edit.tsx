import { useLocalSearchParams } from "expo-router";
import CareFormScreen from "../../../../../src/screens/CareFormScreen";

export default function EditCareTaskRoute() {
  const { id, taskId } = useLocalSearchParams<{ id: string; taskId: string }>();
  return <CareFormScreen petId={id} taskId={taskId} />;
}
