import { useLocalSearchParams } from "expo-router";
import CareTaskDetailScreen from "../../../../src/screens/CareTaskDetailScreen";

export default function CareTaskDetailRoute() {
  const { id, taskId } = useLocalSearchParams<{ id: string; taskId: string }>();
  return <CareTaskDetailScreen petId={id} taskId={taskId} />;
}
