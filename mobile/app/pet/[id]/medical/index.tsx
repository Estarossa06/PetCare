import { useLocalSearchParams } from "expo-router";
import MedicalHistoryScreen from "../../../../src/features/medical/screens/MedicalHistoryScreen";

export default function MedicalHistoryRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <MedicalHistoryScreen petId={id} />;
}
