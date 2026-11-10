import { useLocalSearchParams } from "expo-router";
import CareFormScreen from "../../../../src/screens/CareFormScreen";

export default function NewCareTaskRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <CareFormScreen petId={id} />;
}
