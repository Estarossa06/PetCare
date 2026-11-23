import { useLocalSearchParams } from "expo-router";
import MedicalRecordFormScreen from "../../../../../src/features/medical/screens/MedicalRecordFormScreen";

export default function EditMedicalRecordRoute() {
  const { id, recordId } = useLocalSearchParams<{ id: string; recordId: string }>();
  return <MedicalRecordFormScreen petId={id} recordId={recordId} />;
}
