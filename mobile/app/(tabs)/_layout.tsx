import { Tabs } from "expo-router";
import { colors } from "../../src/theme/tokens";

export default function TabLayout() {
  return (
    <Tabs
      tabBar={() => null}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Inicio" }} />
      <Tabs.Screen name="pets" options={{ title: "Mascotas" }} />
      <Tabs.Screen name="calendar" options={{ title: "Calendario" }} />
      <Tabs.Screen name="assistant" options={{ title: "Asistente" }} />
      <Tabs.Screen name="profile" options={{ title: "Perfil" }} />
    </Tabs>
  );
}
