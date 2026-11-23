import { useLocalSearchParams } from "expo-router";
import CareFormScreen from "../../../../src/features/care/screens/CareFormScreen";

export default function NewCareTaskRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <CareFormScreen petId={id} />;
}
