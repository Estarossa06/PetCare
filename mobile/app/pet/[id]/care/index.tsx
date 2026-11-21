import { useLocalSearchParams } from "expo-router";
import CareDashboardScreen from "../../../../src/features/care/screens/CareDashboardScreen";

export default function CareRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <CareDashboardScreen petId={id} />;
}
