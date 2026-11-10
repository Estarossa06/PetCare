import { useLocalSearchParams } from "expo-router";
import MedicalRecordDetailScreen from "../../../../src/screens/MedicalRecordDetailScreen";

export default function MedicalRecordDetailRoute() {
  const { id, recordId } = useLocalSearchParams<{ id: string; recordId: string }>();
  return <MedicalRecordDetailScreen petId={id} recordId={recordId} />;
}
