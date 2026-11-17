import { StyleSheet } from "react-native";
import { colors, radius, spacing } from "../../../theme/tokens";

export const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: 100,
  },
  wideScroll: {
    paddingHorizontal: spacing.xl,
    paddingLeft: 278,
    paddingTop: spacing.xl,
  },
  page: {
    width: "100%",
    gap: spacing.xl,
  },
  compactPage: {
    gap: spacing.lg,
  },
  widePage: {
    maxWidth: 920,
    alignSelf: "center",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: spacing.md,
  },
  headerCopy: {
    gap: 3,
  },
  eyebrow: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "600",
    textTransform: "capitalize",
  },
  title: {
    color: colors.blueDark,
    fontSize: 29,
    fontWeight: "700",
    letterSpacing: -0.8,
  },
  headerActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  summary: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  summaryIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.blueSoft,
  },
  summaryCopy: {
    flex: 1,
    gap: 4,
  },
  summaryTitle: {
    color: colors.blueDark,
    fontSize: 15,
    fontWeight: "700",
  },
  summaryMeta: {
    color: colors.textMuted,
    fontSize: 13,
  },
  section: {
    gap: spacing.sm,
  },
  sectionHeading: {
    minHeight: 34,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionTitle: {
    color: colors.blueDark,
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: -0.2,
  },
  sectionAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  sectionActionText: {
    color: colors.blue,
    fontSize: 13,
    fontWeight: "600",
  },
  list: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
  },
  listRow: {
    minHeight: 66,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  timeColumn: {
    width: 54,
    alignItems: "center",
    gap: 5,
  },
  rowTime: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "600",
  },
  rowDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.yellow,
  },
  rowCopy: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  rowTitle: {
    color: colors.blueDark,
    fontSize: 14,
    fontWeight: "600",
  },
  rowMeta: {
    color: colors.textMuted,
    fontSize: 12,
  },
  completeButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.blueSoft,
  },
  calendarRow: {
    minHeight: 66,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  calendarIcon: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    backgroundColor: colors.blueSoft,
  },
  reminderCount: {
    color: colors.textMuted,
    fontSize: 12,
  },
  loading: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  muted: {
    color: colors.textMuted,
    fontSize: 13,
  },
  error: {
    color: colors.orange,
    fontSize: 13,
  },
  empty: {
    minHeight: 62,
    justifyContent: "center",
    gap: 5,
    paddingHorizontal: spacing.sm,
  },
  emptyTitle: {
    color: colors.blueDark,
    fontSize: 14,
    fontWeight: "600",
  },
});
