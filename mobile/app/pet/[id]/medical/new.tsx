import { useLocalSearchParams } from "expo-router";
import MedicalRecordFormScreen from "../../../../src/features/medical/screens/MedicalRecordFormScreen";

export default function NewMedicalRecordRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <MedicalRecordFormScreen petId={id} />;
}
