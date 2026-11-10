import { useLocalSearchParams } from "expo-router";
import PetDetailScreen from "../../src/screens/PetDetailScreen";

export default function PetDetailRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <PetDetailScreen petId={id} />;
}
