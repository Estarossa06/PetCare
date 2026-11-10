import type { LucideIcon } from "lucide-react-native";
import {
  ArrowRight,
  CalendarDays,
  Clock3,
  Heart,
  MessageCircle,
  PawPrint,
  ShieldCheck,
  Sparkles,
} from "lucide-react-native";
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppButton } from "../components/ui/AppButton";
import { EmptyState } from "../components/ui/EmptyState";
import { PetAvatar } from "../components/ui/PetAvatar";
import { ScreenHeader } from "../components/ui/ScreenHeader";
import { SurfaceCard } from "../components/ui/SurfaceCard";
import { colors, radius, spacing } from "../theme/tokens";

type PreviewKind = "pets" | "calendar" | "assistant" | "profile";

const previewContent: Record<
  PreviewKind,
  {
    eyebrow: string;
    title: string;
    subtitle: string;
    icon: LucideIcon;
    highlight: string;
    description: string;
    points: string[];
  }
> = {
  pets: {
    eyebrow: "SU FAMILIA, SIEMPRE CERCA",
    title: "Mascotas",
    subtitle: "Un espacio especial para cada uno de tus compañeros.",
    icon: PawPrint,
    highlight: "Perfiles llenos de vida",
    description: "Reúne sus datos y momentos importantes en un solo lugar.",
    points: ["Información importante", "Su historia y rutinas", "Un perfil para cada mascota"],
  },
  calendar: {
    eyebrow: "ORGANIZADOS, SIN PRISAS",
    title: "Calendario",
    subtitle: "Los momentos de cuidado, a la vista y en orden.",
    icon: CalendarDays,
    highlight: "Una semana más tranquila",
    description: "Citas, actividades y recordatorios en una vista compartida.",
    points: ["Vista semanal", "Recordatorios a tiempo", "Rutinas de cada mascota"],
  },
  assistant: {
    eyebrow: "UNA COMPAÑÍA MÁS",
    title: "Asistente",
    subtitle: "Un espacio para conversar sobre el bienestar de tus mascotas.",
    icon: Sparkles,
    highlight: "Preguntas con contexto",
    description: "Las sugerencias se diferenciarán de la información registrada y nunca reemplazarán a un profesional veterinario.",
    points: ["Consejos generales", "Contexto de tus mascotas", "Privacidad en cada consulta"],
  },
  profile: {
    eyebrow: "TU ESPACIO PETCARE",
    title: "Perfil",
    subtitle: "Tu cuenta y tus preferencias, reunidas con claridad.",
    icon: ShieldCheck,
    highlight: "Tu cuenta de demostración",
    description: "Aquí podrás gestionar datos, privacidad, notificaciones y sincronización.",
    points: ["Preferencias personales", "Privacidad y seguridad", "Estado de tus datos"],
  },
};

function DemoPill() {
  return (
    <View style={styles.demoPill}>
      <View style={styles.demoDot} />
      <Text style={styles.demoText}>VISTA DE DEMOSTRACIÓN</Text>
    </View>
  );
}

function PetsPreview() {
  return (
    <View style={styles.previewGrid}>
      <SurfaceCard style={styles.petPreviewCard}>
        <PetAvatar name="Luna" emoji="🐕" tone="yellow" size="large" />
        <View style={styles.petPreviewCopy}>
          <Text style={styles.petPreviewName}>Luna</Text>
          <Text style={styles.petPreviewMeta}>Golden retriever · 3 años</Text>
        </View>
        <Heart size={18} color={colors.blue} />
      </SurfaceCard>
      <SurfaceCard style={styles.petPreviewCard}>
        <PetAvatar name="Milo" emoji="🐈" tone="lavender" size="large" />
        <View style={styles.petPreviewCopy}>
          <Text style={styles.petPreviewName}>Milo</Text>
          <Text style={styles.petPreviewMeta}>Gato mestizo · 2 años</Text>
        </View>
        <Heart size={18} color={colors.blue} />
      </SurfaceCard>
    </View>
  );
}

function CalendarPreview() {
  return (
    <SurfaceCard style={styles.calendarPreview}>
      <View style={styles.calendarPreviewTop}>
        <View>
          <Text style={styles.previewEyebrow}>PRÓXIMAMENTE</Text>
          <Text style={styles.calendarTitle}>Una agenda pensada para ellos</Text>
        </View>
        <View style={styles.calendarIcon}>
          <CalendarDays size={20} color={colors.blue} />
        </View>
      </View>
      <View style={styles.calendarEvent}>
        <View style={styles.eventTime}>
          <Text style={styles.eventDay}>MAR</Text>
          <Text style={styles.eventDate}>12</Text>
        </View>
        <View style={styles.eventRail} />
        <View style={styles.eventCopy}>
          <Text style={styles.eventTitle}>Un recordatorio aparecerá aquí</Text>
          <Text style={styles.eventSub}>Citas y cuidados en un mismo calendario</Text>
        </View>
        <Clock3 size={16} color={colors.textMuted} />
      </View>
      <View style={styles.calendarEvent}>
        <View style={[styles.eventTime, styles.eventTimeYellow]}>
          <Text style={styles.eventDay}>VIE</Text>
          <Text style={styles.eventDate}>15</Text>
        </View>
        <View style={[styles.eventRail, styles.eventRailYellow]} />
        <View style={styles.eventCopy}>
          <Text style={styles.eventTitle}>Rutinas para cada mascota</Text>
          <Text style={styles.eventSub}>Horarios ilustrativos · datos demo</Text>
        </View>
        <Clock3 size={16} color={colors.textMuted} />
      </View>
    </SurfaceCard>
  );
}

function AssistantPreview() {
  return (
    <SurfaceCard style={styles.chatPreview}>
      <View style={styles.chatHeader}>
        <View style={styles.chatAvatar}><Sparkles size={18} color={colors.blue} /></View>
        <View>
          <Text style={styles.chatName}>Asistente PetCare</Text>
          <Text style={styles.chatStatus}>Vista de ejemplo · sin IA conectada</Text>
        </View>
      </View>
      <View style={styles.chatBubble}>
        <Text style={styles.chatBubbleText}>
          ¡Hola! Aquí podrás resolver dudas generales de bienestar. Las respuestas no sustituyen la orientación veterinaria.
        </Text>
      </View>
      <View style={styles.chatInputPreview}>
        <Text style={styles.chatPlaceholder}>Escribe tu pregunta...</Text>
        <View style={styles.chatSend}><ArrowRight size={16} color={colors.surface} /></View>
      </View>
    </SurfaceCard>
  );
}

function ProfilePreview() {
  return (
    <SurfaceCard style={styles.profileCard}>
      <View style={styles.profileTop}>
        <View style={styles.profileAvatar}><Text style={styles.profileInitials}>AT</Text></View>
        <View style={styles.profileCopy}>
          <Text style={styles.profileName}>Ana Torres</Text>
          <Text style={styles.profileEmail}>ana.ejemplo@petcare.demo</Text>
        </View>
        <View style={styles.demoTag}><Text style={styles.demoTagText}>DEMO</Text></View>
      </View>
      <View style={styles.profileDivider} />
      <View style={styles.profileStatus}>
        <View style={styles.statusIcon}><ShieldCheck size={18} color={colors.blue} /></View>
        <View style={styles.statusCopy}>
          <Text style={styles.statusTitle}>Tus datos, bajo tu control</Text>
          <Text style={styles.statusDescription}>Las opciones de cuenta aún no están conectadas.</Text>
        </View>
      </View>
    </SurfaceCard>
  );
}

export default function SectionPreviewScreen({ kind }: { kind: PreviewKind }) {
  const { width } = useWindowDimensions();
  const wide = width >= 900;
  const compact = width < 540;
  const content = previewContent[kind];
  const Icon = content.icon;

  return (
    <SafeAreaView edges={["top"]} style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={[styles.scrollContent, wide && styles.wideScrollContent]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.page, wide && styles.widePage]}>
          <View style={styles.topRow}><DemoPill /></View>
          <ScreenHeader eyebrow={content.eyebrow} title={content.title} subtitle={content.subtitle} />

          <SurfaceCard style={[styles.heroCard, compact && styles.heroCardCompact]}>
            <View style={[styles.heroCopy, compact && styles.heroCopyCompact]}>
              <View style={styles.heroIcon}><Icon size={22} color={colors.blue} /></View>
              <Text style={styles.heroTitle}>{content.highlight}</Text>
              <Text style={styles.heroDescription}>{content.description}</Text>
              <View style={styles.demoNote}>
                <Sparkles size={14} color="#A16207" />
                <Text style={styles.demoNoteText}>Estamos preparando este espacio para ti.</Text>
              </View>
            </View>
            <View style={[styles.heroArt, compact && styles.heroArtCompact]} pointerEvents="none">
              <View style={[styles.heroArtCircle, compact && styles.heroArtCircleCompact]}>
                <Icon size={compact ? 38 : 54} color={colors.blue} strokeWidth={1.3} />
              </View>
              <View style={[styles.heroArtDot, compact && styles.heroArtDotCompact]} />
            </View>
          </SurfaceCard>

          {kind === "pets" ? <PetsPreview /> : null}
          {kind === "calendar" ? <CalendarPreview /> : null}
          {kind === "assistant" ? <AssistantPreview /> : null}
          {kind === "profile" ? <ProfilePreview /> : null}

          <View style={styles.sectionTitleRow}>
            <Text style={styles.sectionTitle}>
              {kind === "pets" ? "Lo que podrás tener" : kind === "calendar" ? "Todo a su tiempo" : kind === "assistant" ? "Conversaciones cuidadosas" : "Una cuenta a tu manera"}
            </Text>
            <Text style={styles.previewLabel}>VISTA PREVIA</Text>
          </View>
          <View style={[styles.pointsGrid, wide && styles.pointsGridWide]}>
            {content.points.map((point, index) => (
              <SurfaceCard key={point} style={styles.pointCard}>
                <View style={[styles.pointIcon, index === 1 && styles.pointIconYellow]}>
                  {index === 0 ? <PawPrint size={17} color={colors.blue} /> : index === 1 ? <Heart size={17} color="#A16207" /> : <ShieldCheck size={17} color={colors.blue} />}
                </View>
                <Text style={styles.pointText}>{point}</Text>
              </SurfaceCard>
            ))}
          </View>
          <View style={styles.emptyCard}>
            <EmptyState
              icon={kind === "assistant" ? MessageCircle : Icon}
              title={kind === "assistant" ? "Aquí comenzará la conversación" : "Tu espacio está listo para crecer"}
              description="Las funciones de esta sección llegarán en una próxima entrega. Esta vista no guarda ni modifica datos."
            />
            <AppButton label="Disponible próximamente" variant="secondary" disabled />
          </View>
          <Text style={styles.footerNote}>Contenido ilustrativo · ninguna acción de negocio está habilitada</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 100,
  },
  wideScrollContent: {
    paddingHorizontal: 30,
    paddingTop: 32,
    paddingBottom: 40,
    paddingLeft: 278,
  },
  page: {
    width: "100%",
    alignSelf: "center",
    gap: spacing.lg,
  },
  widePage: {
    maxWidth: 1040,
  },
  topRow: {
    alignItems: "flex-end",
  },
  demoPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    backgroundColor: colors.yellowSoft,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: radius.pill,
  },
  demoDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#D97706",
  },
  demoText: {
    color: "#92400E",
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.4,
  },
  heroCard: {
    minHeight: 208,
    flexDirection: "row",
    alignItems: "center",
    overflow: "hidden",
    padding: 24,
    backgroundColor: colors.surface,
  },
  heroCardCompact: {
    minHeight: 236,
    alignItems: "flex-start",
    padding: 20,
  },
  heroCopy: {
    zIndex: 1,
    flex: 1,
    maxWidth: 580,
  },
  heroCopyCompact: {
    maxWidth: "100%",
  },
  heroIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.blueSoft,
    marginBottom: 14,
  },
  heroTitle: {
    color: colors.text,
    fontSize: 21,
    fontWeight: "800",
    letterSpacing: -0.5,
  },
  heroDescription: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 20,
    marginTop: 6,
    maxWidth: 470,
  },
  demoNote: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginTop: 15,
    alignSelf: "flex-start",
    backgroundColor: colors.yellowSoft,
    borderRadius: radius.pill,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  demoNoteText: {
    color: "#92400E",
    fontSize: 10,
    fontWeight: "700",
  },
  heroArt: {
    width: 190,
    height: 165,
    alignItems: "center",
    justifyContent: "center",
  },
  heroArtCompact: {
    position: "absolute",
    width: 106,
    height: 100,
    right: 3,
    bottom: -5,
    opacity: 0.55,
  },
  heroArtCircle: {
    width: 108,
    height: 108,
    borderRadius: 54,
    backgroundColor: colors.blueSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  heroArtCircleCompact: {
    width: 82,
    height: 82,
    borderRadius: 41,
  },
  heroArtDot: {
    position: "absolute",
    top: 16,
    right: 24,
    width: 17,
    height: 17,
    borderRadius: 9,
    backgroundColor: colors.yellow,
  },
  heroArtDotCompact: {
    width: 13,
    height: 13,
    top: 10,
    right: 11,
  },
  previewGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
  },
  petPreviewCard: {
    flex: 1,
    minWidth: 225,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
  },
  petPreviewCopy: {
    flex: 1,
  },
  petPreviewName: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "800",
  },
  petPreviewMeta: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 4,
  },
  calendarPreview: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  calendarPreviewTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 3,
  },
  previewEyebrow: {
    color: colors.blue,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1,
  },
  calendarTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "800",
    marginTop: 5,
  },
  calendarIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.blueSoft,
  },
  calendarEvent: {
    minHeight: 68,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 10,
  },
  eventTime: {
    width: 44,
    height: 48,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.blueSoft,
  },
  eventTimeYellow: {
    backgroundColor: colors.yellowSoft,
  },
  eventDay: {
    color: colors.blue,
    fontSize: 8,
    fontWeight: "800",
  },
  eventDate: {
    color: colors.blueDark,
    fontSize: 17,
    fontWeight: "800",
    lineHeight: 20,
  },
  eventRail: {
    width: 3,
    height: 38,
    borderRadius: 2,
    backgroundColor: colors.blue,
  },
  eventRailYellow: {
    backgroundColor: colors.yellow,
  },
  eventCopy: {
    flex: 1,
  },
  eventTitle: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "700",
  },
  eventSub: {
    color: colors.textMuted,
    fontSize: 10,
    marginTop: 4,
  },
  chatPreview: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  chatHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  chatAvatar: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.blueSoft,
  },
  chatName: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "800",
  },
  chatStatus: {
    color: colors.textMuted,
    fontSize: 10,
    marginTop: 3,
  },
  chatBubble: {
    maxWidth: 570,
    alignSelf: "flex-start",
    padding: spacing.md,
    borderRadius: 15,
    borderTopLeftRadius: 4,
    backgroundColor: colors.blueSoft,
  },
  chatBubbleText: {
    color: colors.blueDark,
    fontSize: 12,
    lineHeight: 19,
  },
  chatInputPreview: {
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingLeft: spacing.md,
    paddingRight: 5,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    backgroundColor: colors.background,
  },
  chatPlaceholder: {
    color: "#94A3B8",
    fontSize: 12,
  },
  chatSend: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.blue,
  },
  profileCard: {
    padding: spacing.lg,
  },
  profileTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  profileAvatar: {
    width: 58,
    height: 58,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.blueMuted,
  },
  profileInitials: {
    color: colors.blueDark,
    fontSize: 17,
    fontWeight: "800",
  },
  profileCopy: {
    flex: 1,
  },
  profileName: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "800",
  },
  profileEmail: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 4,
  },
  demoTag: {
    backgroundColor: colors.yellowSoft,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: radius.pill,
  },
  demoTagText: {
    color: "#92400E",
    fontSize: 9,
    fontWeight: "800",
  },
  profileDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.lg,
  },
  profileStatus: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  statusIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.blueSoft,
  },
  statusCopy: {
    flex: 1,
  },
  statusTitle: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "700",
  },
  statusDescription: {
    color: colors.textMuted,
    fontSize: 10,
    marginTop: 4,
  },
  sectionTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 4,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "800",
  },
  previewLabel: {
    color: "#94A3B8",
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  pointsGrid: {
    gap: spacing.sm,
  },
  pointsGridWide: {
    flexDirection: "row",
  },
  pointCard: {
    flex: 1,
    minHeight: 74,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  pointIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: colors.blueSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  pointIconYellow: {
    backgroundColor: colors.yellowSoft,
  },
  pointText: {
    flex: 1,
    color: colors.text,
    fontSize: 12,
    fontWeight: "700",
  },
  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingBottom: spacing.lg,
    alignItems: "center",
  },
  footerNote: {
    color: "#94A3B8",
    fontSize: 10,
    textAlign: "center",
    marginTop: 2,
  },
});
