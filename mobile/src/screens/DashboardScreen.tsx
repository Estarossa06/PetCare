import { useCallback, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import {
  ArrowRight,
  ArrowUpRight,
  Bell,
  CalendarDays,
  Clock3,
  HeartPulse,
  PawPrint,
  Plus,
  Sparkles,
  type LucideIcon,
} from "lucide-react-native";
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppButton } from "../components/ui/AppButton";
import { PetAvatar } from "../components/ui/PetAvatar";
import { ScreenHeader } from "../components/ui/ScreenHeader";
import { SurfaceCard } from "../components/ui/SurfaceCard";
import { careRepository } from "../care/careRepository";
import type { CareTask } from "../care/types";
import { calendarRepository } from "../calendar/calendarRepository";
import type { CalendarItem } from "../calendar/types";
import { colors, radius, spacing } from "../theme/tokens";

const pets = [
  { name: "Luna", details: "Golden retriever · 3 años", emoji: "🐕", tone: "yellow" as const, note: "Paseo a las 17:00" },
  { name: "Milo", details: "Gato mestizo · 2 años", emoji: "🐈", tone: "lavender" as const, note: "Todo al día" },
];

function DemoLabel() {
  return (
    <View style={styles.demoLabel}>
      <View style={styles.demoDot} />
      <Text style={styles.demoText}>Datos de demostración</Text>
    </View>
  );
}

function DashboardTopBar() {
  return (
    <View style={styles.topBar}>
      <View style={styles.mobileBrand}>
        <View style={styles.miniBrandMark}>
          <Text style={styles.miniBrandPaw}>🐾</Text>
        </View>
        <Text style={styles.mobileBrandName}>PetCare</Text>
      </View>
      <View style={styles.topBarRight}>
        <DemoLabel />
        <View style={styles.notificationButton}>
          <Bell size={19} color={colors.textMuted} strokeWidth={1.9} />
          <View style={styles.notificationDot} />
        </View>
        <View style={styles.userAvatar}>
          <Text style={styles.userInitials}>AT</Text>
        </View>
      </View>
    </View>
  );
}

function WelcomeHero({ onPress, compact }: { onPress: () => void; compact: boolean }) {
  return (
    <View style={[styles.hero, compact && styles.heroCompact]}>
      <View style={[styles.heroContent, compact && styles.heroContentCompact]}>
        <View style={styles.heroEyebrow}>
          <Sparkles size={14} color={colors.yellow} />
          <Text style={styles.heroEyebrowText}>SU BIENESTAR, EN UN SOLO LUGAR</Text>
        </View>
        <Text style={styles.heroTitle}>Cada día es mejor{`\n`}cuando están bien.</Text>
        <Text style={styles.heroSubtitle}>
          Organiza sus cuidados y disfruta más momentos juntos.
        </Text>
        <View style={styles.heroAction}>
          <AppButton label="Ver mis mascotas" icon={ArrowRight} onPress={onPress} />
        </View>
      </View>
      <View style={[styles.heroArtwork, compact && styles.heroArtworkCompact]} pointerEvents="none">
        <View style={styles.heroSun} />
        <View style={styles.heroCircle}>
          <Text style={styles.heroPet}>🐶</Text>
        </View>
        <View style={styles.heroSparkleOne}><Sparkles size={17} color={colors.yellow} fill={colors.yellow} /></View>
        <View style={styles.heroSparkleTwo}><Sparkles size={11} color="#BFDBFE" fill="#BFDBFE" /></View>
      </View>
    </View>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  helper,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  helper: string;
  tone: "blue" | "yellow" | "green";
}) {
  return (
    <SurfaceCard style={styles.summaryCard}>
      <View style={styles.summaryTop}>
        <View
          style={[
            styles.summaryIcon,
            tone === "blue" ? styles.summaryIconBlue : tone === "yellow" ? styles.summaryIconYellow : styles.summaryIconGreen,
          ]}
        >
          <Icon size={18} color={tone === "blue" ? colors.blue : tone === "yellow" ? "#A16207" : colors.green} />
        </View>
        <ArrowUpRight size={16} color="#94A3B8" />
      </View>
      <Text style={styles.summaryValue}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryHelper}>{helper}</Text>
    </SurfaceCard>
  );
}

function SectionTitle({ title, action }: { title: string; action?: string }) {
  return (
    <View style={styles.sectionTitleRow}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {action ? (
        <Text style={styles.sectionAction}>
          {action} <Text style={styles.actionArrow}>›</Text>
        </Text>
      ) : null}
    </View>
  );
}

function PetCard({ pet }: { pet: (typeof pets)[number] }) {
  return (
    <SurfaceCard style={styles.petCard}>
      <View style={styles.petCardTop}>
        <PetAvatar name={pet.name} emoji={pet.emoji} size="large" tone={pet.tone} />
        <View style={styles.petChevron}>
          <ArrowUpRight size={16} color={colors.textMuted} />
        </View>
      </View>
      <Text style={styles.petName}>{pet.name}</Text>
      <Text style={styles.petDetails}>{pet.details}</Text>
      <View style={styles.petNote}>
        <View style={styles.petNoteDot} />
        <Text style={styles.petNoteText}>{pet.note}</Text>
      </View>
    </SurfaceCard>
  );
}

function RoutineRow({ task, onComplete, onOpen }: { task: CareTask & { pet_name: string }; onComplete: (task: CareTask) => void; onOpen: (task: CareTask) => void }) {
  const date = new Intl.DateTimeFormat("es-ES", {
    timeZone: task.timezone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(task.next_run_at ?? task.starts_at));
  return (
    <View style={styles.routineRow}>
      <Text style={styles.routineTime}>{date}</Text>
      <View style={styles.routineMarker}>
        <Clock3 size={11} color={colors.blue} />
      </View>
      <Pressable onPress={() => onOpen(task)} style={styles.routineCopy}>
        <Text style={styles.routineTitle}>{task.title}</Text>
        <Text style={styles.routinePet}>{task.pet_name}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={() => onComplete(task)} style={styles.upcomingPill}><Text style={styles.upcomingText}>Completar</Text></Pressable>
    </View>
  );
}

export default function DashboardScreen() {
  const router = useRouter();
  const [careData, setCareData] = useState<Awaited<ReturnType<typeof careRepository.dashboard>>>({
    today: [],
    upcoming: [],
    overdue: [],
    completedToday: 0,
  });
  const [careLoading, setCareLoading] = useState(true);
  const [careError, setCareError] = useState<string | null>(null);
  const [calendarItems, setCalendarItems] = useState<CalendarItem[]>([]);
  const [reminderCount, setReminderCount] = useState(0);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const loadCalendar = useCallback(async () => {
    setCalendarError(null);
    try {
      const data = await calendarRepository.dashboard();
      setCalendarItems(data.items.filter((item) =>
        item.status === "overdue"
        || (item.source === "calendar_reminder" && item.status === "pending")
        || item.startsAt >= new Date().toISOString(),
      ).slice(0, 5));
      setReminderCount(data.reminders.length);
    } catch (error) {
      setCalendarError(error instanceof Error ? error.message : "No se pudo cargar el calendario.");
    }
  }, []);
  const loadCare = useCallback(async () => {
    setCareLoading(true);
    setCareError(null);
    try {
      setCareData(await careRepository.dashboard());
    } catch (error) {
      setCareError(error instanceof Error ? error.message : "No se pudieron cargar las actividades.");
    } finally {
      setCareLoading(false);
    }
  }, []);
  useFocusEffect(useCallback(() => { void loadCare(); void loadCalendar(); }, [loadCare, loadCalendar]));
  const { width } = useWindowDimensions();
  const wide = width >= 900;
  const compact = width < 540;
  const today = new Date();
  const formattedDate = today
    .toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" })
    .toLocaleUpperCase("es-ES");
  const month = today.toLocaleDateString("es-ES", { month: "short" }).replace(".", "").toLocaleUpperCase("es-ES");
  const day = String(today.getDate()).padStart(2, "0");
  const weekday = today.toLocaleDateString("es-ES", { weekday: "long" });

  return (
    <SafeAreaView edges={["top"]} style={styles.safeArea}>
      <View style={styles.scene}>
        <ScrollView
          contentContainerStyle={[styles.scrollContent, wide && styles.wideScrollContent]}
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.page, wide && styles.widePage]}>
            <DashboardTopBar />
            <ScreenHeader
              eyebrow={formattedDate}
              title="Hola, Ana"
              subtitle="Un día bonito para cuidar de quienes más quieres."
            />
            <WelcomeHero onPress={() => router.navigate("/pets")} compact={compact} />

            <View style={[styles.summaryGrid, !wide && styles.summaryGridMobile]}>
              <SummaryCard icon={HeartPulse} label="Bienestar" value="Bien" helper="Todo en equilibrio" tone="green" />
              <SummaryCard icon={PawPrint} label="Mascotas" value="2" helper="Luna y Milo" tone="blue" />
              <SummaryCard
                icon={CalendarDays}
                label="Cuidados hoy"
                value={String(careData.today.length)}
                helper={`${careData.completedToday} completadas · ${careData.overdue.length} atrasadas`}
                tone="yellow"
              />
            </View>

            <View style={[styles.contentColumns, !wide && styles.contentColumnsMobile]}>
              <View style={styles.primaryColumn}>
                <View style={styles.section}>
                  <SectionTitle title="Tus compañeros" action="Ver todos" />
                  <View style={styles.petGrid}>
                    {pets.map((pet) => <PetCard key={pet.name} pet={pet} />)}
                    <SurfaceCard style={styles.addPetCard}>
                      <View style={styles.addPetIcon}><Plus size={22} color={colors.blue} /></View>
                      <Text style={styles.addPetTitle}>¿Más patitas?</Text>
                      <Text style={styles.addPetCopy}>Aquí habrá espacio para un nuevo compañero.</Text>
                    </SurfaceCard>
                  </View>
                </View>

                <SurfaceCard style={styles.assistantCard}>
                  <View style={styles.assistantIcon}>
                    <Sparkles size={20} color={colors.blue} />
                  </View>
                  <View style={styles.assistantCopy}>
                    <Text style={styles.assistantEyebrow}>A TU LADO, CADA DÍA</Text>
                    <Text style={styles.assistantTitle}>¿Una duda sobre sus cuidados?</Text>
                    <Text style={styles.assistantDescription}>Conoce el espacio del asistente de PetCare.</Text>
                  </View>
                  <AppButton
                    label="Explorar"
                    variant="secondary"
                    size="small"
                    onPress={() => router.navigate("/assistant")}
                  />
                </SurfaceCard>
              </View>

              <View style={styles.secondaryColumn}>
                <View style={styles.section}>
                  <SectionTitle title="Cuidados para hoy" action="Rutinas" />
                  <SurfaceCard style={styles.scheduleCard}>
                    <View style={styles.scheduleHeader}>
                      <View style={styles.dateTile}>
                        <Text style={styles.dateMonth}>{month}</Text>
                        <Text style={styles.dateNumber}>{day}</Text>
                      </View>
                      <View style={styles.scheduleIntro}>
                        <Text style={styles.scheduleHeading}>{`${weekday.charAt(0).toLocaleUpperCase("es-ES")}${weekday.slice(1)} tranquilo`}</Text>
                        <Text style={styles.scheduleSubheading}>Un pequeño plan para hoy</Text>
                      </View>
                    </View>
                    <View style={styles.scheduleDivider} />
                    {careLoading ? (
                      <Text style={styles.scheduleFootnoteText}>Cargando cuidados guardados en este dispositivo…</Text>
                    ) : careError ? (
                      <Text accessibilityRole="alert" style={styles.scheduleFootnoteText}>{careError}</Text>
                    ) : [...new Map([...careData.overdue, ...careData.today].map((task) => [task.id, task])).values()].length ? (
                      [...new Map([...careData.overdue, ...careData.today].map((task) => [task.id, task])).values()].slice(0, 5).map((task) => (
                        <RoutineRow
                          key={task.id}
                          task={task}
                          onOpen={(selected) => router.push(`/pet/${selected.pet_id}/care/${selected.id}`)}
                          onComplete={(selected) => {
                            void careRepository.recordExecution(selected.id, "completed").then(loadCare).catch((error: unknown) => {
                              setCareError(error instanceof Error ? error.message : "No se pudo completar la actividad.");
                            });
                          }}
                        />
                      ))
                    ) : careData.upcoming.length ? (
                      <>
                        <Text style={styles.scheduleFootnoteText}>No hay actividades previstas para hoy. Próximas:</Text>
                        {careData.upcoming.slice(0, 3).map((task) => (
                          <Pressable key={task.id} onPress={() => router.push(`/pet/${task.pet_id}/care/${task.id}`)} style={styles.routineRow}>
                            <Clock3 size={15} color={colors.blue} />
                            <View style={styles.routineCopy}><Text style={styles.routineTitle}>{task.title}</Text><Text style={styles.routinePet}>{task.pet_name}</Text></View>
                          </Pressable>
                        ))}
                      </>
                    ) : (
                      <View style={styles.scheduleEmpty}>
                        <Text style={styles.scheduleFootnoteText}>Aún no hay rutinas registradas.</Text>
                        <AppButton label="Ver mascotas para organizar cuidados" variant="secondary" size="small" onPress={() => router.navigate("/pets")} />
                      </View>
                    )}
                  </SurfaceCard>
                </View>

                <View style={styles.section}>
                  <View style={styles.calendarHeading}>
                    <SectionTitle title="Próximamente" />
                    <Pressable accessibilityRole="button" onPress={() => router.navigate("/calendar")}><Text style={styles.sectionAction}>Abrir calendario ›</Text></Pressable>
                  </View>
                  <SurfaceCard style={styles.scheduleCard}>
                    {calendarError ? <Text accessibilityRole="alert" style={styles.scheduleFootnoteText}>{calendarError}</Text> : (
                      <>
                        <Text style={styles.scheduleFootnoteText}>{reminderCount} recordatorios pendientes</Text>
                        {calendarItems.length ? calendarItems.map((entry) => (
                          <Pressable key={entry.id} onPress={() => {
                            if (entry.source === "calendar_event") router.push(`/calendar/event/${entry.sourceId}`);
                            else if (entry.source === "appointment") router.push(`/calendar/appointment/${entry.sourceId}`);
                            else if (entry.source === "care_task" && entry.petId) router.push(`/pet/${entry.petId}/care/${entry.targetId}`);
                            else if (entry.source === "care_execution" && entry.petId) router.push(`/pet/${entry.petId}/care/${entry.targetId}`);
                            else if (entry.source === "health_record" && entry.petId) router.push(`/pet/${entry.petId}/medical/${entry.targetId}`);
                            else if (entry.source === "calendar_reminder") router.push(`/calendar/reminder/${entry.sourceId}`);
                          }} style={styles.routineRow}>
                            <Clock3 size={15} color={entry.status === "overdue" ? colors.orange : colors.blue} />
                            <View style={styles.routineCopy}>
                              <Text style={styles.routineTitle}>{entry.title}</Text>
                              <Text style={styles.routinePet}>{entry.petName ?? "General"} · {entry.status === "overdue" ? "Atrasado" : new Date(entry.startsAt).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</Text>
                            </View>
                          </Pressable>
                        )) : <Text style={styles.scheduleFootnoteText}>No hay próximos eventos registrados.</Text>}
                      </>
                    )}
                  </SurfaceCard>
                </View>

                <SurfaceCard style={styles.tipCard}>
                  <View style={styles.tipIcon}><HeartPulse size={18} color={colors.blue} /></View>
                  <View style={styles.tipCopy}>
                    <Text style={styles.tipEyebrow}>UN RECORDATORIO AMABLE</Text>
                    <Text style={styles.tipText}>Los pequeños momentos de cuidado también cuentan.</Text>
                  </View>
                </SurfaceCard>
              </View>
            </View>
            <Text style={styles.disclaimer}>
              Los cuidados, eventos y recordatorios se consultan desde SQLite en este dispositivo. Las tarjetas de perfil ilustrativas siguen identificadas como demostración.
            </Text>
          </View>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scene: {
    flex: 1,
    paddingLeft: 0,
  },
  scrollContent: {
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 100,
  },
  wideScrollContent: {
    paddingHorizontal: 30,
    paddingTop: 24,
    paddingBottom: 40,
    paddingLeft: 278,
  },
  page: {
    width: "100%",
    alignSelf: "center",
    gap: 0,
  },
  widePage: {
    maxWidth: 1160,
  },
  topBar: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.lg,
  },
  mobileBrand: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  miniBrandMark: {
    width: 30,
    height: 30,
    borderRadius: 10,
    backgroundColor: colors.blueSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  miniBrandPaw: {
    fontSize: 16,
  },
  mobileBrandName: {
    color: colors.blueDark,
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: -0.4,
  },
  topBarRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  },
  demoLabel: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.yellowSoft,
    paddingHorizontal: 10,
    paddingVertical: 6,
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
    fontSize: 10,
    fontWeight: "800",
  },
  notificationButton: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  notificationDot: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.yellow,
    borderWidth: 1,
    borderColor: colors.surface,
  },
  userAvatar: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    backgroundColor: "#DBEAFE",
    alignItems: "center",
    justifyContent: "center",
  },
  userInitials: {
    color: colors.blueDark,
    fontSize: 12,
    fontWeight: "800",
  },
  hero: {
    minHeight: 256,
    borderRadius: radius.lg,
    overflow: "hidden",
    backgroundColor: colors.blueDark,
    marginBottom: spacing.lg,
    paddingHorizontal: 26,
    paddingVertical: 25,
    flexDirection: "row",
    alignItems: "center",
  },
  heroCompact: {
    minHeight: 286,
    alignItems: "flex-start",
    paddingHorizontal: 21,
    paddingVertical: 22,
  },
  heroContent: {
    zIndex: 1,
    flex: 1,
    maxWidth: 540,
    gap: 12,
  },
  heroContentCompact: {
    maxWidth: 300,
  },
  heroAction: {
    alignSelf: "flex-start",
  },
  heroEyebrow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  heroEyebrowText: {
    color: "#BFDBFE",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
  },
  heroTitle: {
    color: colors.surface,
    fontSize: 31,
    fontWeight: "800",
    lineHeight: 37,
    letterSpacing: -0.8,
  },
  heroSubtitle: {
    maxWidth: 340,
    color: "#CBD5E1",
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 3,
  },
  heroArtwork: {
    width: 228,
    height: 210,
    alignItems: "center",
    justifyContent: "center",
  },
  heroSun: {
    position: "absolute",
    width: 190,
    height: 190,
    borderRadius: 95,
    backgroundColor: "#1E3A70",
    right: 0,
    top: 12,
  },
  heroCircle: {
    width: 142,
    height: 142,
    borderRadius: 71,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.yellow,
    borderWidth: 8,
    borderColor: "rgba(255,255,255,0.12)",
  },
  heroArtworkCompact: {
    position: "absolute",
    width: 130,
    height: 125,
    right: -3,
    bottom: -9,
    opacity: 0.62,
  },
  heroPet: {
    fontSize: 76,
    marginTop: 7,
  },
  heroSparkleOne: {
    position: "absolute",
    top: 34,
    right: 25,
  },
  heroSparkleTwo: {
    position: "absolute",
    bottom: 30,
    left: 25,
  },
  summaryGrid: {
    flexDirection: "row",
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  summaryGridMobile: {
    gap: 9,
  },
  summaryCard: {
    flex: 1,
    minWidth: 0,
    padding: 16,
  },
  summaryTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 13,
  },
  summaryIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  summaryIconBlue: {
    backgroundColor: colors.blueSoft,
  },
  summaryIconYellow: {
    backgroundColor: colors.yellowSoft,
  },
  summaryIconGreen: {
    backgroundColor: colors.greenSoft,
  },
  summaryValue: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: -0.4,
  },
  summaryLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "600",
    marginTop: 3,
  },
  summaryHelper: {
    color: "#94A3B8",
    fontSize: 10,
    marginTop: 8,
  },
  contentColumns: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.lg,
  },
  contentColumnsMobile: {
    flexDirection: "column",
  },
  primaryColumn: {
    flex: 1.45,
    minWidth: 0,
    gap: spacing.lg,
  },
  secondaryColumn: {
    flex: 1,
    minWidth: 0,
    gap: spacing.lg,
  },
  section: {
    gap: spacing.md,
  },
  sectionTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 26,
  },
  calendarHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 26,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "800",
    letterSpacing: -0.25,
  },
  sectionAction: {
    color: colors.blue,
    fontSize: 12,
    fontWeight: "700",
  },
  actionArrow: {
    fontSize: 18,
  },
  petGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  petCard: {
    width: "48%",
    flexGrow: 1,
    padding: 15,
    minWidth: 145,
  },
  petCardTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  petChevron: {
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
  },
  petName: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "800",
  },
  petDetails: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 3,
  },
  petNote: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  petNoteDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.blue,
  },
  petNoteText: {
    flex: 1,
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: "600",
  },
  addPetCard: {
    flexGrow: 1,
    width: "48%",
    minWidth: 145,
    minHeight: 189,
    justifyContent: "center",
    alignItems: "center",
    padding: spacing.md,
    borderStyle: "dashed",
    backgroundColor: "#FBFDFF",
  },
  addPetIcon: {
    width: 42,
    height: 42,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.blueSoft,
    marginBottom: 9,
  },
  addPetTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "800",
    textAlign: "center",
  },
  addPetCopy: {
    color: colors.textMuted,
    fontSize: 10,
    lineHeight: 15,
    textAlign: "center",
    marginTop: 5,
  },
  scheduleCard: {
    padding: 16,
  },
  scheduleEmpty: {
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  scheduleHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: spacing.md,
  },
  dateTile: {
    width: 46,
    height: 52,
    borderRadius: 12,
    backgroundColor: colors.blueSoft,
    justifyContent: "center",
    alignItems: "center",
  },
  dateMonth: {
    color: colors.blue,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.7,
  },
  dateNumber: {
    color: colors.blueDark,
    fontSize: 20,
    lineHeight: 22,
    fontWeight: "800",
  },
  scheduleIntro: {
    flex: 1,
  },
  scheduleHeading: {
    color: colors.text,
    fontSize: 14,
    fontWeight: "800",
  },
  scheduleSubheading: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 4,
  },
  scheduleDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginBottom: 6,
  },
  routineRow: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  routineTime: {
    width: 42,
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: "700",
  },
  routineMarker: {
    width: 18,
    height: 18,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: "#CBD5E1",
    alignItems: "center",
    justifyContent: "center",
  },
  routineMarkerDone: {
    backgroundColor: colors.green,
    borderColor: colors.green,
  },
  routineCopy: {
    flex: 1,
  },
  routineTitle: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "700",
  },
  routineTitleDone: {
    color: colors.textMuted,
  },
  routinePet: {
    color: "#94A3B8",
    fontSize: 10,
    marginTop: 3,
  },
  upcomingPill: {
    backgroundColor: colors.yellowSoft,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  upcomingText: {
    color: "#92400E",
    fontSize: 9,
    fontWeight: "800",
  },
  scheduleFootnote: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingTop: 9,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  scheduleFootnoteText: {
    color: colors.textMuted,
    fontSize: 10,
  },
  assistantCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 16,
    backgroundColor: "#F2F7FF",
    borderColor: "#DBEAFE",
  },
  assistantIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  assistantCopy: {
    flex: 1,
    minWidth: 0,
  },
  assistantEyebrow: {
    color: colors.blue,
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.7,
  },
  assistantTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "800",
    marginTop: 4,
  },
  assistantDescription: {
    color: colors.textMuted,
    fontSize: 10,
    marginTop: 4,
  },
  tipCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 16,
    backgroundColor: "#FFFBEB",
    borderColor: "#FDE68A",
  },
  tipIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  tipCopy: {
    flex: 1,
  },
  tipEyebrow: {
    color: "#A16207",
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.6,
  },
  tipText: {
    color: "#713F12",
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "600",
    marginTop: 4,
  },
  disclaimer: {
    color: "#94A3B8",
    fontSize: 10,
    textAlign: "center",
    marginTop: spacing.xl,
  },
});
