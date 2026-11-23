import type { ComponentProps } from "react";
import {
  CalendarDays,
  House,
  MessageCircle,
  PawPrint,
  UserRound,
  type LucideIcon,
} from "lucide-react-native";
import { Tabs } from "expo-router";
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radius, spacing } from "../theme/tokens";

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>["tabBar"]>>[0];

const navigationItems: Record<string, { label: string; icon: LucideIcon }> = {
  index: { label: "Inicio", icon: House },
  pets: { label: "Mascotas", icon: PawPrint },
  calendar: { label: "Calendario", icon: CalendarDays },
  assistant: { label: "Asistente", icon: MessageCircle },
  profile: { label: "Perfil", icon: UserRound },
};

function NavigationItem({
  route,
  index,
  selected,
  wide,
  onPress,
}: {
  route: TabBarProps["state"]["routes"][number];
  index: number;
  selected: boolean;
  wide: boolean;
  onPress: () => void;
}) {
  const item = navigationItems[route.name];
  if (!item) return null;
  const Icon = item.icon;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={item.label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.navItem,
        wide ? styles.wideItem : styles.mobileItem,
        selected && styles.selectedItem,
        pressed && styles.pressed,
      ]}
      key={`${route.key}-${index}`}
    >
      <Icon
        size={21}
        color={selected ? colors.blue : colors.textMuted}
        strokeWidth={selected ? 2.4 : 1.9}
      />
      <Text style={[styles.navLabel, selected && styles.selectedLabel, !wide && styles.mobileLabel]}>
        {item.label}
      </Text>
      {wide && selected ? <View style={styles.selectionMark} /> : null}
    </Pressable>
  );
}

export function AppTabBar({ state, emitter, navigateToTab }: TabBarProps) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const wide = width >= 900;

  const renderItem = (route: TabBarProps["state"]["routes"][number], index: number) => (
    <NavigationItem
      key={route.key}
      route={route}
      index={index}
      selected={state.index === index}
      wide={wide}
      onPress={() => {
        const event = emitter.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
        if (!event.defaultPrevented && state.index !== index) {
          navigateToTab(route.key);
        }
      }}
    />
  );

  if (wide) {
    return (
      <View style={[styles.sidebar, { paddingTop: Math.max(insets.top, spacing.xl) }]}>
        <View style={styles.brand}>
          <View style={styles.brandMark}>
            <PawPrint size={21} color={colors.blueDark} fill={colors.yellow} strokeWidth={2.2} />
          </View>
          <View>
            <Text style={styles.brandName}>PetCare</Text>
            <Text style={styles.brandCaption}>bienestar en compañía</Text>
          </View>
        </View>
        <Text style={styles.sectionLabel}>MENÚ</Text>
        <View style={styles.navigation}>{state.routes.map(renderItem)}</View>
        <View style={styles.sidebarBottom}>
          <View style={styles.demoDot} />
          <Text style={styles.demoLabel}>Vista de demostración</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.mobileBar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      {state.routes.map(renderItem)}
    </View>
  );
}

const styles = StyleSheet.create({
  sidebar: {
    position: "absolute",
    zIndex: 5,
    top: 0,
    bottom: 0,
    left: 0,
    width: 248,
    backgroundColor: colors.surface,
    borderRightWidth: 1,
    borderRightColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  brand: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: 42,
  },
  brandMark: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: colors.blueSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  brandName: {
    color: colors.blueDark,
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: -0.5,
  },
  brandCaption: {
    color: colors.textMuted,
    fontSize: 10,
    marginTop: 1,
  },
  sectionLabel: {
    color: "#94A3B8",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.1,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  navigation: {
    gap: 5,
  },
  navItem: {
    position: "relative",
    flexDirection: "row",
    alignItems: "center",
  },
  wideItem: {
    height: 48,
    gap: 13,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
  },
  mobileItem: {
    flex: 1,
    minWidth: 54,
    height: 56,
    flexDirection: "column",
    justifyContent: "center",
    gap: 4,
    borderRadius: radius.sm,
  },
  selectedItem: {
    backgroundColor: colors.blueSoft,
  },
  pressed: {
    opacity: 0.75,
  },
  navLabel: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: "600",
  },
  mobileLabel: {
    fontSize: 10,
    fontWeight: "600",
  },
  selectedLabel: {
    color: colors.blue,
    fontWeight: "800",
  },
  selectionMark: {
    position: "absolute",
    left: 0,
    top: 9,
    bottom: 9,
    width: 3,
    borderRadius: 3,
    backgroundColor: colors.blue,
  },
  sidebarBottom: {
    marginTop: "auto",
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  demoDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.yellow,
  },
  demoLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "600",
  },
  mobileBar: {
    position: "absolute",
    zIndex: 5,
    bottom: 0,
    left: 0,
    right: 0,
    minHeight: 66,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: 8,
    paddingTop: 5,
  },
});
