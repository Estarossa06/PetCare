import { useLocalSearchParams } from "expo-router";
import CareTaskDetailScreen from "../../../../src/features/care/screens/CareTaskDetailScreen";

export default function CareTaskDetailRoute() {
  const { id, taskId } = useLocalSearchParams<{ id: string; taskId: string }>();
  return <CareTaskDetailScreen petId={id} taskId={taskId} />;
}
