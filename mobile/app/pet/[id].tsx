import { useLocalSearchParams } from "expo-router";
import PetDetailScreen from "../../src/features/pets/screens/PetDetailScreen";

export default function PetDetailRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <PetDetailScreen petId={id} />;
}
