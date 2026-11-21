import type { LucideIcon } from "lucide-react-native";
import {
  CalendarDays,
  Clock3,
  Heart,
  PawPrint,
  ShieldCheck,
  Sparkles,
} from "lucide-react-native";
import { ScrollView, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppButton } from "../../../components/ui/AppButton";
import { EmptyState } from "../../../components/ui/EmptyState";
import { PetAvatar } from "../../../components/ui/PetAvatar";
import { ScreenHeader } from "../../../components/ui/ScreenHeader";
import { SurfaceCard } from "../../../components/ui/SurfaceCard";
import { colors } from "../../../theme/tokens";
import { styles } from "./SectionPreviewScreen.styles";

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
    eyebrow: "ASISTENTE",
    title: "KIRAI",
    subtitle: "Orientación general, con cuidado y contexto.",
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
          <Text style={styles.chatName}>Asistente de bienestar</Text>
          <Text style={styles.chatStatus}>En preparación</Text>
        </View>
      </View>
      <Text style={styles.chatBubbleText}>
        Sus sugerencias complementarán, nunca reemplazarán, la orientación veterinaria.
      </Text>
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

          {kind === "assistant" ? <AssistantPreview /> : <SurfaceCard style={[styles.heroCard, compact && styles.heroCardCompact]}>
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
          </SurfaceCard>}

          {kind === "pets" ? <PetsPreview /> : null}
          {kind === "calendar" ? <CalendarPreview /> : null}
          {kind === "profile" ? <ProfilePreview /> : null}

          {kind !== "assistant" ? <View style={styles.sectionTitleRow}>
            <Text style={styles.sectionTitle}>
              {kind === "pets" ? "Lo que podrás tener" : kind === "calendar" ? "Todo a su tiempo" : "Una cuenta a tu manera"}
            </Text>
            <Text style={styles.previewLabel}>VISTA PREVIA</Text>
          </View> : null}
          {kind !== "assistant" ? <View style={[styles.pointsGrid, wide && styles.pointsGridWide]}>
            {content.points.map((point, index) => (
              <SurfaceCard key={point} style={styles.pointCard}>
                <View style={[styles.pointIcon, index === 1 && styles.pointIconYellow]}>
                  {index === 0 ? <PawPrint size={17} color={colors.blue} /> : index === 1 ? <Heart size={17} color="#A16207" /> : <ShieldCheck size={17} color={colors.blue} />}
                </View>
                <Text style={styles.pointText}>{point}</Text>
              </SurfaceCard>
            ))}
          </View> : null}
          {kind !== "assistant" ? <View style={styles.emptyCard}>
            <EmptyState
              icon={Icon}
              title="Tu espacio está listo para crecer"
              description="Las funciones de esta sección llegarán en una próxima entrega. Esta vista no guarda ni modifica datos."
            />
            <AppButton label="Disponible próximamente" variant="secondary" disabled />
          </View> : null}
          {kind !== "assistant" ? <Text style={styles.footerNote}>Contenido ilustrativo · ninguna acción de negocio está habilitada</Text> : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
