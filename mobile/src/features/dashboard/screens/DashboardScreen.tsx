import { useCallback, useEffect, useMemo, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import {
  ArrowRight,
  CalendarDays,
  Check,
  Clock3,
  PawPrint,
  Plus,
} from "lucide-react-native";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppButton } from "../../../components/ui/AppButton";
import { SurfaceCard } from "../../../components/ui/SurfaceCard";
import { colors } from "../../../theme/tokens";
import { careRepository } from "../../care/careRepository";
import type { CareTask } from "../../care/types";
import { calendarRepository } from "../../calendar/calendarRepository";
import type { CalendarItem } from "../../calendar/types";
import { styles } from "./DashboardScreen.styles";
import { reportClientError, reportComponentState, reportScreenOpened } from "../../../diagnostics/renderDiagnostics";

type RoutineTask = CareTask & { pet_name: string };

function SectionHeading({
  title,
  action,
  onPress,
}: {
  title: string;
  action?: string;
  onPress?: () => void;
}) {
  return (
    <View style={styles.sectionHeading}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {action ? (
        <Pressable accessibilityRole="button" onPress={onPress} style={styles.sectionAction}>
          <Text style={styles.sectionActionText}>{action}</Text>
          <ArrowRight size={14} color={colors.blue} />
        </Pressable>
      ) : null}
    </View>
  );
}

function RoutineRow({
  task,
  canComplete,
  onComplete,
  onOpen,
}: {
  task: RoutineTask;
  canComplete: boolean;
  onComplete: (task: CareTask) => void;
  onOpen: (task: CareTask) => void;
}) {
  const date = new Intl.DateTimeFormat("es-ES", {
    timeZone: task.timezone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(task.next_run_at ?? task.starts_at));

  return (
    <View style={styles.listRow}>
      <View style={styles.timeColumn}>
        <Text style={styles.rowTime}>{date}</Text>
        <View style={styles.rowDot} />
      </View>
      <Pressable
        accessibilityRole="button"
        onPress={() => onOpen(task)}
        style={styles.rowCopy}
      >
        <Text style={styles.rowTitle}>{task.title}</Text>
        <Text style={styles.rowMeta}>{task.pet_name}</Text>
      </Pressable>
      {canComplete ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Completar ${task.title}`}
          onPress={() => onComplete(task)}
          style={styles.completeButton}
        >
          <Check size={17} color={colors.blue} />
        </Pressable>
      ) : null}
    </View>
  );
}

function calendarRoute(entry: CalendarItem): string | null {
  if (entry.source === "calendar_event") return `/calendar/event/${entry.sourceId}`;
  if (entry.source === "appointment") return `/calendar/appointment/${entry.sourceId}`;
  if (entry.source === "care_task" || entry.source === "care_execution") {
    return entry.petId ? `/pet/${entry.petId}/care/${entry.targetId}` : null;
  }
  if (entry.source === "health_record") {
    return entry.petId ? `/pet/${entry.petId}/medical/${entry.targetId}` : null;
  }
  if (entry.source === "calendar_reminder") {
    return `/calendar/reminder/${entry.sourceId}`;
  }
  return null;
}

function CalendarRow({ entry, onPress }: { entry: CalendarItem; onPress: () => void }) {
  const time = entry.allDay
    ? "Todo el día"
    : new Intl.DateTimeFormat("es-ES", {
        timeZone: entry.timezone,
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(entry.startsAt));

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={styles.calendarRow}
    >
      <View style={styles.calendarIcon}>
        <CalendarDays size={17} color={colors.blue} />
      </View>
      <View style={styles.rowCopy}>
        <Text style={styles.rowTitle}>{entry.title}</Text>
        <Text style={styles.rowMeta}>{entry.petName ?? "General"} · {time}</Text>
      </View>
      <ArrowRight size={16} color={colors.textMuted} />
    </Pressable>
  );
}

export default function DashboardScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const wide = width >= 900;
  const compact = width < 400;
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
  const [calendarLoading, setCalendarLoading] = useState(true);
  const [calendarError, setCalendarError] = useState<string | null>(null);

  const loadCalendar = useCallback(async () => {
    setCalendarLoading(true);
    setCalendarError(null);
    try {
      const data = await calendarRepository.dashboard();
      const now = new Date().toISOString();
      setCalendarItems(
        data.items
          .filter((item) =>
            item.status === "overdue" ||
            (item.source === "calendar_reminder" && item.status === "pending") ||
            (item.source !== "care_task" && item.source !== "care_execution" && item.startsAt >= now),
          )
          .slice(0, 4),
      );
      setReminderCount(data.reminders.length);
    } catch (error) {
      reportClientError("dashboard", "dashboard_agenda", error);
      setCalendarError(error instanceof Error ? error.message : "No se pudo cargar el calendario.");
    } finally {
      setCalendarLoading(false);
    }
  }, []);

  const loadCare = useCallback(async () => {
    setCareLoading(true);
    setCareError(null);
    try {
      setCareData(await careRepository.dashboard());
    } catch (error) {
      reportClientError("dashboard", "care_dashboard", error);
      setCareError(error instanceof Error ? error.message : "No se pudieron cargar las actividades.");
    } finally {
      setCareLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    reportScreenOpened("dashboard");
    void loadCare();
    void loadCalendar();
  }, [loadCare, loadCalendar]));

  const todayTasks = useMemo(
    () => [...new Map([...careData.overdue, ...careData.today].map((task) => [task.id, task])).values()],
    [careData.overdue, careData.today],
  );
  const displayedTasks = todayTasks.length ? todayTasks : careData.upcoming.slice(0, 3);
  useEffect(() => {
    reportComponentState("dashboard", "care_dashboard", {
      loading: careLoading,
      dataCount: displayedTasks.length,
      secondaryCount: careData.overdue.length,
      errorPresent: Boolean(careError),
      renderBranch: careLoading ? "loading" : careError ? "error" : displayedTasks.length ? "data" : "empty",
    });
    reportComponentState("dashboard", "dashboard_agenda", {
      loading: calendarLoading,
      dataCount: calendarItems.length,
      secondaryCount: reminderCount,
      errorPresent: Boolean(calendarError),
      renderBranch: calendarLoading ? "loading" : calendarError ? "error" : calendarItems.length ? "data" : "empty",
    });
  }, [careData.overdue.length, careError, careLoading, calendarError, calendarItems.length, calendarLoading, displayedTasks.length, reminderCount]);
  const date = new Date().toLocaleDateString("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <SafeAreaView edges={["top"]} style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={[styles.scroll, wide && styles.wideScroll]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.page, compact && styles.compactPage, wide && styles.widePage]}>
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={styles.eyebrow}>{date}</Text>
              <Text style={styles.title}>Tu día</Text>
            </View>
            <View style={styles.headerActions}>
              <AppButton
                label="Mascotas"
                icon={PawPrint}
                variant="secondary"
                size="small"
                onPress={() => router.navigate("/pets")}
              />
              <AppButton
                label="Nuevo evento"
                icon={Plus}
                size="small"
                onPress={() => router.push("/calendar/new")}
              />
            </View>
          </View>

          <SurfaceCard style={styles.summary}>
            <View style={styles.summaryIcon}><Clock3 size={18} color={colors.blue} /></View>
            <View style={styles.summaryCopy}>
              <Text style={styles.summaryTitle}>Cuidados de hoy</Text>
              {careLoading ? (
                <Text style={styles.summaryMeta}>Actualizando agenda…</Text>
              ) : (
                <Text style={styles.summaryMeta}>
                  {todayTasks.length} pendientes · {careData.completedToday} completados
                  {careData.overdue.length ? ` · ${careData.overdue.length} atrasados` : ""}
                </Text>
              )}
            </View>
            <ArrowRight size={16} color={colors.textMuted} />
          </SurfaceCard>

          <View style={styles.section}>
            <SectionHeading title={todayTasks.length ? "Para hoy" : "Próximos cuidados"} />
            {careLoading ? (
              <View style={styles.loading}>
                <ActivityIndicator color={colors.blue} />
                <Text style={styles.muted}>Cargando cuidados…</Text>
              </View>
            ) : careError ? (
              <Text accessibilityRole="alert" style={styles.error}>{careError}</Text>
            ) : displayedTasks.length ? (
              <View style={styles.list}>
                {displayedTasks.slice(0, 4).map((task) => (
                  <RoutineRow
                    key={task.id}
                    task={task}
                    canComplete={todayTasks.length > 0}
                    onOpen={(selected) => router.push(`/pet/${selected.pet_id}/care/${selected.id}`)}
                    onComplete={(selected) => {
                      void careRepository.recordExecution(selected.id, "completed")
                        .then(loadCare)
                        .catch((error: unknown) => {
                          setCareError(error instanceof Error ? error.message : "No se pudo completar la actividad.");
                        });
                    }}
                  />
                ))}
              </View>
            ) : (
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>Día despejado</Text>
                <Text style={styles.muted}>No hay cuidados próximos registrados.</Text>
              </View>
            )}
          </View>

          <View style={styles.section}>
            <SectionHeading
              title="Agenda"
              action="Calendario"
              onPress={() => router.navigate("/calendar")}
            />
            {reminderCount ? (
              <Text style={styles.reminderCount}>
                {reminderCount} {reminderCount === 1 ? "recordatorio pendiente" : "recordatorios pendientes"}
              </Text>
            ) : null}
            {calendarLoading ? (
              <View style={styles.loading}>
                <ActivityIndicator color={colors.blue} />
                <Text style={styles.muted}>Cargando agenda…</Text>
              </View>
            ) : calendarError ? (
              <Text accessibilityRole="alert" style={styles.error}>{calendarError}</Text>
            ) : calendarItems.length ? (
              <View style={styles.list}>
                {calendarItems.map((entry) => {
                  const route = calendarRoute(entry);
                  return route ? (
                    <CalendarRow
                      key={entry.id}
                      entry={entry}
                      onPress={() => router.push(route)}
                    />
                  ) : null;
                })}
              </View>
            ) : (
              <View style={styles.empty}>
                <Text style={styles.muted}>No hay más eventos próximos.</Text>
              </View>
            )}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
