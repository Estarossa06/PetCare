import { useRouter } from "expo-router";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
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
import { checkKiraiAvailability, askKirai } from "../api";
import {
  kiraiConversationReducer,
  kiraiHistoryForRequest,
} from "../conversation";
import { colors, spacing } from "../../../theme/tokens";

type RequestError = { code: string; message: string };
type AvailabilityState = "idle" | "checking" | "available" | "unavailable";

function requestErrorMessage(error: unknown): RequestError {
  if (error instanceof ApiClientError) {
    switch (error.code) {
      case "KIRAI_CONNECTION_ERROR":
        return {
          code: error.code,
          message:
            "La API no pudo conectarse con Ollama. Revisa el servicio y reintenta.",
        };
      case "KIRAI_UNAVAILABLE":
        return {
          code: error.code,
          message:
            "Ollama o el modelo qwen3:8b no está disponible. Revisa el proveedor y reintenta.",
        };
      case "RATE_LIMITED":
        return {
          code: error.code,
          message:
            "Has alcanzado el límite temporal de consultas. Inténtalo más tarde.",
        };
      case "UNAUTHENTICATED":
      case "INVALID_REFRESH_TOKEN":
        return {
          code: "SESSION_INVALID",
          message: "Tu sesión ya no es válida. Inicia sesión nuevamente.",
        };
      case "VALIDATION_ERROR":
        return {
          code: error.code,
          message:
            "La pregunta no pudo validarse. Revísala e inténtalo de nuevo.",
        };
      default:
        return {
          code: error.code,
          message: "No se pudo completar la consulta. Inténtalo nuevamente.",
        };
    }
  }
  if (error instanceof TypeError) {
    return {
      code: "API_CONNECTION_ERROR",
      message:
        "No se pudo conectar con la API de PetCare. Comprueba la URL y la conexión e inténtalo nuevamente.",
    };
  }
  return {
    code: "REQUEST_FAILED",
    message: "No se pudo completar la consulta. Inténtalo nuevamente.",
  };
}

export default function KiraiScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { user, loading, error: authError, restore } = useAuth();
  const [question, setQuestion] = useState("");
  const [conversation, dispatchConversation] = useReducer(
    kiraiConversationReducer,
    [],
  );
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<RequestError | null>(null);
  const [availabilityState, setAvailabilityState] =
    useState<AvailabilityState>("idle");
  const [availabilityError, setAvailabilityError] =
    useState<RequestError | null>(null);
  const conversationRequestId = useRef(0);

  const checkAvailability = useCallback(async () => {
    setAvailabilityState("checking");
    setAvailabilityError(null);
    try {
      await checkKiraiAvailability();
      setAvailabilityState("available");
    } catch (checkError) {
      setAvailabilityError(requestErrorMessage(checkError));
      setAvailabilityState("unavailable");
    }
  }, []);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      setAvailabilityState("idle");
      setAvailabilityError(null);
      return;
    }
    void checkAvailability();
  }, [loading, user, checkAvailability]);

  useEffect(() => {
    conversationRequestId.current += 1;
    dispatchConversation({ type: "clear" });
    setQuestion("");
    setError(null);
    setPendingQuestion(null);
    setBusy(false);
  }, [user?.id]);

  const submit = async () => {
    const message = question.trim();
    if (!message) {
      setError({
        code: "VALIDATION_ERROR",
        message: "Escribe una pregunta antes de consultar a KIRAI.",
      });
      return;
    }

    const requestId = ++conversationRequestId.current;
    setBusy(true);
    setError(null);
    setQuestion("");
    setPendingQuestion(message);
    try {
      const result = await askKirai(
        message,
        kiraiHistoryForRequest(conversation),
      );
      if (conversationRequestId.current !== requestId) return;
      dispatchConversation({
        type: "add-turn",
        question: message,
        answer: result.answer,
        truncated: result.truncated,
      });
    } catch (requestError) {
      if (conversationRequestId.current !== requestId) return;
      setQuestion(message);
      setError(requestErrorMessage(requestError));
    } finally {
      if (conversationRequestId.current === requestId) {
        setPendingQuestion(null);
        setBusy(false);
      }
    }
  };

  const startNewConversation = () => {
    dispatchConversation({ type: "clear" });
    setQuestion("");
    setError(null);
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
            <Text style={styles.noticeTitle}>
              Contexto de conversación limitado
            </Text>
            <Text style={styles.noticeText}>
              KIRAI conserva en memoria los turnos recientes mientras dure esta
              sesión. No guarda conversaciones permanentemente ni adjunta datos
              de tus mascotas.
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
              <Text style={styles.cardTitle}>
                {authError
                  ? "No se pudo validar la sesión"
                  : "Inicia sesión para consultar"}
              </Text>
              <Text style={styles.muted}>
                {authError ??
                  "KIRAI requiere una cuenta PetCare. Iniciar sesión no sube ni vincula los datos locales de tus mascotas."}
              </Text>
              {authError ? (
                <AppButton label="Reintentar sesión" onPress={() => void restore()} />
              ) : null}
              <AppButton
                label="Iniciar sesión"
                variant={authError ? "secondary" : "primary"}
                onPress={() =>
                  router.push({ pathname: "/auth", params: { mode: "login" } })
                }
              />
            </SurfaceCard>
          ) : (
            <>
              {availabilityState !== "available" ? (
                <SurfaceCard style={styles.card}>
                  <Text style={styles.cardTitle}>
                    {availabilityState === "checking"
                      ? "Comprobando disponibilidad de KIRAI"
                      : "KIRAI no está disponible"}
                  </Text>
                  {availabilityState === "checking" ? (
                    <ActivityIndicator color={colors.blue} />
                  ) : (
                    <>
                      {availabilityError ? (
                        <Text style={styles.error}>{availabilityError.message}</Text>
                      ) : (
                        <Text style={styles.muted}>No se pudo confirmar la disponibilidad.</Text>
                      )}
                      {availabilityError?.code === "SESSION_INVALID" ? (
                        <AppButton
                          label="Iniciar sesión nuevamente"
                          onPress={() => router.push({ pathname: "/auth", params: { mode: "login" } })}
                        />
                      ) : (
                        <AppButton
                          label="Reintentar disponibilidad"
                          onPress={() => void checkAvailability()}
                        />
                      )}
                    </>
                  )}
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
                    {error ? <Text style={styles.error}>{error.message}</Text> : null}
                    <AppButton
                      label="Consultar a KIRAI"
                      loading={busy}
                      disabled={busy || !question.trim()}
                      onPress={() => void submit()}
                    />
                    {error &&
                    [
                      "API_CONNECTION_ERROR",
                      "KIRAI_CONNECTION_ERROR",
                      "KIRAI_UNAVAILABLE",
                    ].includes(error.code) ? (
                      <AppButton
                        label="Reintentar consulta"
                        variant="secondary"
                        disabled={busy || !question.trim()}
                        onPress={() => void submit()}
                      />
                    ) : null}
                    {error?.code === "SESSION_INVALID" ? (
                      <AppButton
                        label="Iniciar sesión nuevamente"
                        variant="secondary"
                        onPress={() =>
                          router.push({ pathname: "/auth", params: { mode: "login" } })
                        }
                      />
                    ) : null}
                  </SurfaceCard>

                  {conversation.length > 0 || pendingQuestion ? (
                    <SurfaceCard style={styles.answerCard}>
                      <Text style={styles.answerEyebrow}>CONVERSACIÓN</Text>
                      <View style={styles.messageList}>
                        {conversation.map((message, index) => (
                          <View
                            key={`${index}-${message.role}`}
                            style={styles.message}
                          >
                            <Text style={styles.messageRole}>
                              {message.role === "user" ? "TÚ" : "KIRAI"}
                            </Text>
                            <Text selectable style={styles.answer}>
                              {message.content}
                            </Text>
                            {message.truncated ? (
                              <Text style={styles.muted}>
                                La respuesta puede estar incompleta.
                              </Text>
                            ) : null}
                          </View>
                        ))}
                        {pendingQuestion ? (
                          <View style={styles.message}>
                            <Text style={styles.messageRole}>TÚ</Text>
                            <Text selectable style={styles.answer}>
                              {pendingQuestion}
                            </Text>
                            <ActivityIndicator color={colors.blue} />
                          </View>
                        ) : null}
                      </View>
                      {conversation.length > 0 ? (
                        <AppButton
                          label="Nueva conversación"
                          variant="secondary"
                          disabled={busy}
                          onPress={startNewConversation}
                        />
                      ) : null}
                    </SurfaceCard>
                  ) : null}
                </>
              )}
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
  messageList: { gap: spacing.md },
  message: { gap: spacing.xs },
  messageRole: {
    color: colors.blue,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
  },
  answerEyebrow: {
    color: colors.blue,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1,
  },
  answer: { color: colors.text, fontSize: 15, lineHeight: 23 },
});
