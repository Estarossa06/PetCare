import { useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppButton } from "../../../components/ui/AppButton";
import { AppTextField } from "../../../components/ui/TextField";
import { ScreenHeader } from "../../../components/ui/ScreenHeader";
import { SurfaceCard } from "../../../components/ui/SurfaceCard";
import { ApiClientError } from "../../auth/apiClient";
import { useAuth } from "../../auth/AuthProvider";
import { askKirai } from "../api";
import { colors, spacing } from "../../../theme/tokens";

function requestErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    switch (error.code) {
      case "KIRAI_UNAVAILABLE":
        return "KIRAI no está disponible en este momento. Inténtalo más tarde.";
      case "RATE_LIMITED":
        return "Has alcanzado el límite temporal de consultas. Inténtalo más tarde.";
      case "UNAUTHENTICATED":
      case "INVALID_REFRESH_TOKEN":
        return "Tu sesión expiró. Inicia sesión nuevamente desde Perfil.";
      case "VALIDATION_ERROR":
        return "La pregunta no pudo validarse. Revísala e inténtalo de nuevo.";
      default:
        return "No se pudo completar la consulta. Inténtalo nuevamente.";
    }
  }
  if (error instanceof TypeError) {
    return "No se pudo conectar con PetCare. Comprueba tu conexión e inténtalo nuevamente.";
  }
  return "No se pudo completar la consulta. Inténtalo nuevamente.";
}

export default function KiraiScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { user, loading } = useAuth();
  const [question, setQuestion] = useState("");
  const [lastQuestion, setLastQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [truncated, setTruncated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const message = question.trim();
    if (!message) {
      setError("Escribe una pregunta antes de consultar a KIRAI.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const result = await askKirai(message);
      setLastQuestion(message);
      setQuestion("");
      setAnswer(result.answer);
      setTruncated(result.truncated);
    } catch (requestError) {
      setError(requestErrorMessage(requestError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.inner, width >= 760 && styles.innerWide]}>
          <ScreenHeader
            eyebrow="ASISTENTE DE BIENESTAR"
            title="KIRAI"
            subtitle="Orientación general para el cuidado de animales."
          />

          <View style={styles.notice}>
            <Text style={styles.noticeTitle}>Una pregunta por consulta</Text>
            <Text style={styles.noticeText}>
              Solo se envía la pregunta escrita. No se adjuntan datos de tus
              mascotas ni se guarda un historial de conversación.
            </Text>
          </View>

          <View style={styles.warning}>
            <Text style={styles.warningText}>
              KIRAI no sustituye a un profesional veterinario. Ante dificultad
              para respirar, convulsiones, sangrado abundante o posible
              intoxicación, busca atención veterinaria urgente.
            </Text>
          </View>

          {loading ? (
            <SurfaceCard style={styles.loadingCard}>
              <ActivityIndicator color={colors.blue} />
              <Text style={styles.muted}>Comprobando tu sesión…</Text>
            </SurfaceCard>
          ) : !user ? (
            <SurfaceCard style={styles.card}>
              <Text style={styles.cardTitle}>Inicia sesión para consultar</Text>
              <Text style={styles.muted}>
                KIRAI requiere una cuenta PetCare. Iniciar sesión no sube ni
                vincula los datos locales de tus mascotas.
              </Text>
              <AppButton
                label="Iniciar sesión"
                onPress={() =>
                  router.push({ pathname: "/auth", params: { mode: "login" } })
                }
              />
            </SurfaceCard>
          ) : (
            <>
              <SurfaceCard style={styles.card}>
                <AppTextField
                  label="¿Qué te gustaría saber?"
                  value={question}
                  onChangeText={setQuestion}
                  placeholder="Escribe una pregunta general sobre bienestar animal"
                  multiline
                  maxLength={2_000}
                  editable={!busy}
                  style={styles.input}
                  accessibilityLabel="Pregunta para KIRAI"
                />
                <Text style={styles.counter}>{question.length}/2000</Text>
                {error ? <Text style={styles.error}>{error}</Text> : null}
                <AppButton
                  label="Consultar a KIRAI"
                  loading={busy}
                  disabled={busy || !question.trim()}
                  onPress={() => void submit()}
                />
              </SurfaceCard>

              {answer ? (
                <SurfaceCard style={styles.answerCard}>
                  <Text style={styles.answerEyebrow}>RESPUESTA DE KIRAI</Text>
                  <Text style={styles.question}>{lastQuestion}</Text>
                  <Text selectable style={styles.answer}>
                    {answer}
                  </Text>
                  {truncated ? (
                    <Text style={styles.muted}>
                      La respuesta puede estar incompleta.
                    </Text>
                  ) : null}
                </SurfaceCard>
              ) : null}
            </>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  content: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: 100,
  },
  inner: { width: "100%", maxWidth: 620, alignSelf: "center", gap: spacing.md },
  innerWide: { maxWidth: 760 },
  notice: {
    padding: spacing.md,
    gap: spacing.xs,
    borderRadius: 14,
    backgroundColor: colors.blueSoft,
  },
  noticeTitle: { color: colors.blueDark, fontSize: 14, fontWeight: "800" },
  noticeText: { color: colors.blueDark, fontSize: 13, lineHeight: 19 },
  warning: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 12,
    backgroundColor: colors.yellowSoft,
  },
  warningText: { color: "#78350F", fontSize: 12, lineHeight: 18 },
  card: { gap: spacing.md },
  loadingCard: {
    minHeight: 120,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  cardTitle: { color: colors.blueDark, fontSize: 17, fontWeight: "800" },
  muted: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  input: { minHeight: 120, textAlignVertical: "top", paddingTop: spacing.md },
  counter: { alignSelf: "flex-end", color: colors.textMuted, fontSize: 11 },
  error: { color: colors.orange, fontSize: 13, lineHeight: 19 },
  answerCard: { gap: spacing.md },
  answerEyebrow: {
    color: colors.blue,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
  },
  question: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  answer: { color: colors.text, fontSize: 15, lineHeight: 23 },
});
