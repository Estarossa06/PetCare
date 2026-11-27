import { useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, X } from "lucide-react-native";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing } from "../../theme/tokens";

type CalendarDateFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  mode?: "date" | "datetime";
  hint?: string;
  allowClear?: boolean;
};

const weekdays = ["L", "M", "X", "J", "V", "S", "D"];
const pad = (value: number) => String(value).padStart(2, "0");

function parseLocalValue(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour = "0", minute = "0"] = match;
  const result = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  return result.getFullYear() === Number(year) && result.getMonth() === Number(month) - 1 && result.getDate() === Number(day)
    ? result
    : null;
}

function serializeLocalValue(value: Date, mode: "date" | "datetime"): string {
  const date = `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  return mode === "date" ? date : `${date}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

function displayValue(value: string, mode: "date" | "datetime"): string {
  const date = parseLocalValue(value);
  if (!date) return "Seleccionar fecha";
  const formatted = new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "long", year: "numeric" }).format(date);
  return mode === "datetime" ? `${formatted} · ${pad(date.getHours())}:${pad(date.getMinutes())}` : formatted;
}

export function CalendarDateField({ label, value, onChange, mode = "date", hint, allowClear = false }: CalendarDateFieldProps) {
  const [visible, setVisible] = useState(false);
  const [pickerView, setPickerView] = useState<"calendar" | "months" | "years">("calendar");
  const [draft, setDraft] = useState(() => parseLocalValue(value) ?? new Date());
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const date = parseLocalValue(value) ?? new Date();
    return new Date(date.getFullYear(), date.getMonth(), 1);
  });

  const open = () => {
    const date = parseLocalValue(value) ?? new Date();
    setDraft(date);
    setVisibleMonth(new Date(date.getFullYear(), date.getMonth(), 1));
    setPickerView("calendar");
    setVisible(true);
  };

  const moveMonth = (amount: number) => setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() + amount, 1));
  const changeTime = (hours: number, minutes: number) => setDraft((current) => {
    const next = new Date(current);
    next.setHours(next.getHours() + hours, next.getMinutes() + minutes);
    return next;
  });

  const firstWeekday = (visibleMonth.getDay() + 6) % 7;
  const daysInMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 0).getDate();
  const monthTitle = new Intl.DateTimeFormat("es-CO", { month: "long" }).format(visibleMonth);
  const monthNames = Array.from({ length: 12 }, (_, month) => new Intl.DateTimeFormat("es-CO", { month: "short" }).format(new Date(2020, month, 1)));
  const yearPageStart = Math.floor(visibleMonth.getFullYear() / 12) * 12;
  const calendarCells = Array.from({ length: 42 }, (_, index) => {
    const day = index - firstWeekday + 1;
    return day >= 1 && day <= daysInMonth ? day : null;
  });

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.triggerRow}>
        <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${displayValue(value, mode)}. Abrir calendario`} onPress={open} style={styles.trigger}>
          <CalendarDays size={18} color={colors.blue} />
          <Text style={[styles.triggerText, !value && styles.placeholder]} numberOfLines={1}>{displayValue(value, mode)}</Text>
        </Pressable>
        {allowClear && value ? <Pressable accessibilityRole="button" accessibilityLabel={`Quitar ${label}`} onPress={() => onChange("")} style={styles.clear}><X size={17} color={colors.textMuted} /></Pressable> : null}
      </View>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}

      <Modal visible={visible} transparent animationType="fade" onRequestClose={() => setVisible(false)}>
        <View style={styles.backdrop}>
          <View style={styles.dialog}>
            <View style={styles.dialogHeader}>
              <Text style={styles.dialogTitle}>{label}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Cerrar calendario" onPress={() => setVisible(false)} style={styles.close}><X size={19} color={colors.textMuted} /></Pressable>
            </View>
            <View style={styles.monthRow}>
              <Pressable accessibilityRole="button" accessibilityLabel={pickerView === "calendar" ? "Mes anterior" : pickerView === "months" ? "Año anterior" : "Años anteriores"} onPress={() => pickerView === "calendar" ? moveMonth(-1) : pickerView === "months" ? setVisibleMonth((current) => new Date(current.getFullYear() - 1, current.getMonth(), 1)) : setVisibleMonth((current) => new Date(current.getFullYear() - 12, current.getMonth(), 1))} style={styles.monthArrow}><ChevronLeft size={20} color={colors.blueDark} /></Pressable>
              {pickerView === "calendar" ? <View style={styles.monthTitleGroup}>
                <Pressable accessibilityRole="button" accessibilityLabel="Elegir mes" onPress={() => setPickerView("months")}><Text style={styles.monthTitle}>{monthTitle}</Text></Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel="Elegir año" onPress={() => setPickerView("years")}><Text style={styles.yearTitle}>{visibleMonth.getFullYear()}</Text></Pressable>
              </View> : <Text style={styles.monthTitle}>{pickerView === "months" ? `Mes · ${visibleMonth.getFullYear()}` : `${yearPageStart}–${yearPageStart + 11}`}</Text>}
              <Pressable accessibilityRole="button" accessibilityLabel={pickerView === "calendar" ? "Mes siguiente" : pickerView === "months" ? "Año siguiente" : "Años siguientes"} onPress={() => pickerView === "calendar" ? moveMonth(1) : pickerView === "months" ? setVisibleMonth((current) => new Date(current.getFullYear() + 1, current.getMonth(), 1)) : setVisibleMonth((current) => new Date(current.getFullYear() + 12, current.getMonth(), 1))} style={styles.monthArrow}><ChevronRight size={20} color={colors.blueDark} /></Pressable>
            </View>
            <View style={styles.calendarPanel}>
            {pickerView === "calendar" ? <View style={styles.grid}>
              {weekdays.map((day, index) => <Text key={`${day}-${index}`} style={styles.weekday}>{day}</Text>)}
              {calendarCells.map((day, index) => {
                if (day === null) return <View key={`empty-${index}`} style={styles.dayCell} />;
                const selected = draft.getFullYear() === visibleMonth.getFullYear() && draft.getMonth() === visibleMonth.getMonth() && draft.getDate() === day;
                return <Pressable key={day} accessibilityRole="button" accessibilityLabel={`${day} ${monthTitle} ${visibleMonth.getFullYear()}`} accessibilityState={{ selected }} onPress={() => setDraft((current) => new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), day, current.getHours(), current.getMinutes()))} style={[styles.dayCell, selected && styles.daySelected]}>
                  <Text style={[styles.dayText, selected && styles.dayTextSelected]}>{day}</Text>
                </Pressable>;
              })}
            </View> : pickerView === "months" ? <View style={styles.selectorGrid}>{monthNames.map((name, month) => <Pressable key={month} accessibilityRole="button" accessibilityState={{ selected: visibleMonth.getMonth() === month }} onPress={() => { setVisibleMonth((current) => new Date(current.getFullYear(), month, 1)); setPickerView("calendar"); }} style={[styles.selectorOption, visibleMonth.getMonth() === month && styles.selectorOptionSelected]}><Text style={[styles.selectorText, visibleMonth.getMonth() === month && styles.selectorTextSelected]}>{name}</Text></Pressable>)}</View> : <View style={styles.selectorGrid}>{Array.from({ length: 12 }, (_, index) => yearPageStart + index).map((year) => <Pressable key={year} accessibilityRole="button" accessibilityState={{ selected: visibleMonth.getFullYear() === year }} onPress={() => { setVisibleMonth((current) => new Date(year, current.getMonth(), 1)); setPickerView("calendar"); }} style={[styles.selectorOption, visibleMonth.getFullYear() === year && styles.selectorOptionSelected]}><Text style={[styles.selectorText, visibleMonth.getFullYear() === year && styles.selectorTextSelected]}>{year}</Text></Pressable>)}</View>}
            </View>
            {mode === "datetime" ? <View style={styles.timeRow}>
              <Clock3 size={17} color={colors.blue} />
              <Text style={styles.timeLabel}>Hora local</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Restar una hora" onPress={() => changeTime(-1, 0)} style={styles.timeAdjust}><Text style={styles.adjustText}>−</Text></Pressable>
              <Text style={styles.timeValue}>{pad(draft.getHours())}:{pad(draft.getMinutes())}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Sumar una hora" onPress={() => changeTime(1, 0)} style={styles.timeAdjust}><Text style={styles.adjustText}>+</Text></Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Restar cinco minutos" onPress={() => changeTime(0, -5)} style={styles.timeAdjust}><Text style={styles.adjustText}>−5</Text></Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Sumar cinco minutos" onPress={() => changeTime(0, 5)} style={styles.timeAdjust}><Text style={styles.adjustText}>+5</Text></Pressable>
            </View> : null}
            <View style={styles.footer}>
              {allowClear && value ? <Pressable onPress={() => { onChange(""); setVisible(false); }} style={styles.clearAction}><Text style={styles.clearText}>Quitar fecha</Text></Pressable> : <View style={styles.footerSpacer} />}
              <Pressable onPress={() => setVisible(false)} style={styles.cancel}><Text style={styles.cancelText}>Cancelar</Text></Pressable>
              <Pressable onPress={() => { onChange(serializeLocalValue(draft, mode)); setVisible(false); }} style={styles.confirm}><Text style={styles.confirmText}>Elegir fecha</Text></Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: spacing.xs },
  label: { color: colors.text, fontSize: 13, fontWeight: "700" },
  triggerRow: { flexDirection: "row", gap: spacing.xs },
  trigger: { minHeight: 48, flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, backgroundColor: colors.surface, paddingHorizontal: spacing.md },
  triggerText: { flex: 1, color: colors.text, fontSize: 15, textTransform: "capitalize" },
  placeholder: { color: colors.textMuted },
  clear: { width: 46, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, backgroundColor: colors.surface },
  hint: { color: colors.textMuted, fontSize: 12 },
  backdrop: { flex: 1, justifyContent: "center", padding: spacing.md, backgroundColor: "rgba(15, 23, 42, 0.48)" },
  dialog: { width: "100%", maxWidth: 420, alignSelf: "center", gap: spacing.md, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface },
  dialogHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  dialogTitle: { flex: 1, color: colors.blueDark, fontSize: 16, fontWeight: "800" },
  close: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  monthRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  monthArrow: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: colors.blueSoft },
  monthTitleGroup: { minWidth: 178, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xs },
  monthTitle: { color: colors.blueDark, fontSize: 16, fontWeight: "800", textTransform: "capitalize" },
  yearTitle: { color: colors.blue, fontSize: 15, fontWeight: "800" },
  calendarPanel: { height: 280, justifyContent: "center" },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  weekday: { width: `${100 / 7}%`, height: 28, textAlign: "center", textAlignVertical: "center", color: colors.textMuted, fontSize: 12, fontWeight: "800" },
  dayCell: { width: `${100 / 7}%`, height: 42, alignItems: "center", justifyContent: "center", borderRadius: radius.pill },
  daySelected: { backgroundColor: colors.blue },
  dayText: { color: colors.text, fontSize: 14, fontWeight: "600" },
  dayTextSelected: { color: colors.onAccent, fontWeight: "800" },
  selectorGrid: { flexDirection: "row", flexWrap: "wrap", alignContent: "center", justifyContent: "center", gap: 8 },
  selectorOption: { width: "23%", height: 48, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, backgroundColor: colors.surface },
  selectorOptionSelected: { borderColor: colors.blue, backgroundColor: colors.blue },
  selectorText: { color: colors.textMuted, fontSize: 13, fontWeight: "700", textTransform: "capitalize" },
  selectorTextSelected: { color: colors.onAccent, fontWeight: "900" },
  timeRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", flexWrap: "wrap", gap: 7, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm },
  timeLabel: { color: colors.textMuted, fontSize: 12, marginRight: 3 },
  timeAdjust: { minWidth: 34, height: 34, paddingHorizontal: 7, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: colors.blueSoft },
  adjustText: { color: colors.blueDark, fontSize: 13, fontWeight: "800" },
  timeValue: { minWidth: 50, textAlign: "center", color: colors.blueDark, fontSize: 15, fontWeight: "900" },
  footer: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 8, marginTop: 2 },
  footerSpacer: { flex: 1 },
  clearAction: { flex: 1 },
  clearText: { color: colors.orange, fontSize: 13, fontWeight: "700" },
  cancel: { minHeight: 42, alignItems: "center", justifyContent: "center", paddingHorizontal: 12 },
  cancelText: { color: colors.textMuted, fontSize: 13, fontWeight: "700" },
  confirm: { minHeight: 42, alignItems: "center", justifyContent: "center", paddingHorizontal: 16, borderRadius: radius.pill, backgroundColor: colors.blue },
  confirmText: { color: colors.onAccent, fontSize: 13, fontWeight: "800" },
});
