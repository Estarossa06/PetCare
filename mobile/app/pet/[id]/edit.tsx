import { useLocalSearchParams } from "expo-router";
import PetFormScreen from "../../../src/screens/PetFormScreen";

export default function EditPetRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <PetFormScreen petId={id} />;
}
