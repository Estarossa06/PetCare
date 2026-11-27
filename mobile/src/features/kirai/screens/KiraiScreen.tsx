import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect, useRouter } from "expo-router";
import * as Crypto from "expo-crypto";
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View, useWindowDimensions, type ScrollViewInstance,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ArrowLeft, Clock3, MessageCircle, Plus, Send, X } from "lucide-react-native";
import { AppButton } from "../../../components/ui/AppButton";
import { useAuth } from "../../auth/AuthProvider";
import { ApiClientError } from "../../auth/apiClient";
import { colors, radius, spacing } from "../../../theme/tokens";
import { reportClientError, reportComponentState, reportScreenOpened } from "../../../diagnostics/renderDiagnostics";
import { readPendingPetContext } from "../localContext";
import { deliverKiraiQuestion } from "../delivery";
import { kiraiDeliveryLabel, mergeKiraiMessagePage } from "../messageState";
import { askKirai, checkKiraiAvailability, loadKiraiConversations, loadKiraiMessagePage } from "../api";
import {
  cacheKiraiConversations, cacheKiraiMessages, completePendingKiraiQuestion,
  failPendingKiraiQuestion, listLocalKiraiConversations, listLocalKiraiMessages,
  newKiraiId, savePendingKiraiQuestion, type KiraiConversation, type KiraiMessage,
} from "../storage";

function requestErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.code === "KIRAI_CONNECTION_ERROR") return "KIRAI no pudo conectarse al servicio. Tu mensaje quedó guardado; reinténtalo cuando vuelva la conexión.";
    if (error.code === "KIRAI_UNAVAILABLE" || error.status >= 500) return "KIRAI no pudo completar la respuesta. Tu mensaje quedó guardado; puedes reintentarlo.";
    if (error.code === "RATE_LIMITED") return "Has alcanzado el límite temporal de consultas. Inténtalo más tarde.";
    if (error.code === "SESSION_INVALID" || error.code === "INVALID_REFRESH_TOKEN" || error.status === 401) return "Tu sesión ya no es válida. Inicia sesión nuevamente.";
    if (error.code === "VALIDATION_ERROR") return "No pudimos enviar ese mensaje. Revísalo e inténtalo de nuevo.";
  }
  return "No pudimos conectar con KIRAI. Tu mensaje quedó guardado y puedes reintentarlo.";
}

export default function KiraiScreen() {
  const router = useRouter();
  const { user, loading: authLoading, error: authError, restore } = useAuth();
  const { width } = useWindowDimensions();
  const [question, setQuestion] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<KiraiConversation[]>([]);
  const [messages, setMessages] = useState<KiraiMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [sendingRequestId, setSendingRequestId] = useState<string | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [olderOffset, setOlderOffset] = useState(0);
  const [availability, setAvailability] = useState<"checking" | "available" | "unavailable">("checking");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const scrollRef = useRef<ScrollViewInstance | null>(null);
  const generationRef = useRef(0);
  const shouldScrollRef = useRef(true);
  const activeUserRef = useRef<string | null>(user?.id ?? null);
  activeUserRef.current = user?.id ?? null;
  const wide = width >= 760;

  const loadConversation = useCallback(async (authUserId: string, id: string) => {
    const generation = ++generationRef.current;
    setConversationId(id);
    setLoadingHistory(true);
    setNotice("");
    try {
      let localBefore: KiraiMessage[] = [];
      try { localBefore = await listLocalKiraiMessages(authUserId, id); } catch (localError) {
        reportClientError("kirai", "kirai_chat", localError);
      }
      const page = await loadKiraiMessagePage(id, 0, 100);
      if (generation !== generationRef.current) return;
      await cacheKiraiMessages(authUserId, id, page.messages);
      const localAfter = await listLocalKiraiMessages(authUserId, id).catch(() => localBefore);
      setMessages(mergeKiraiMessagePage(page.messages, localAfter));
      setOlderOffset(page.messages.length);
      setHasOlderMessages(page.hasMore);
      shouldScrollRef.current = true;
    } catch (historyError) {
      reportClientError("kirai", "kirai_chat", historyError);
      try {
        const local = await listLocalKiraiMessages(authUserId, id);
        if (generation !== generationRef.current) return;
        setMessages(local);
        setHasOlderMessages(false);
        setNotice("Mostrando el historial guardado en este dispositivo.");
        shouldScrollRef.current = true;
      } catch (localHistoryError) {
        reportClientError("kirai", "kirai_chat", localHistoryError);
        setMessages([]);
        setNotice("No pudimos abrir esta conversación.");
      }
    } finally {
      if (generation === generationRef.current) setLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    let active = true;
    generationRef.current += 1;
    const generation = generationRef.current;
    setConversationId(null);
    setMessages([]);
    setQuestion("");
    setBusy(false);
    setSendingRequestId(null);
    setNotice("");
    setAvailability("checking");
    void checkKiraiAvailability().then(() => {
      if (active) setAvailability("available");
    }).catch((availabilityError) => {
      reportClientError("kirai", "api_client", availabilityError);
      if (active) setAvailability("unavailable");
    });
    void (async () => {
      try {
        const local = await listLocalKiraiConversations(user.id);
        if (!active || generation !== generationRef.current) return;
        setConversations(local);
        try {
          const remote = await loadKiraiConversations();
          if (!active || generation !== generationRef.current) return;
          await cacheKiraiConversations(user.id, remote);
          const merged = await listLocalKiraiConversations(user.id);
          setConversations(merged);
          if (merged[0]) await loadConversation(user.id, merged[0].id);
        } catch (conversationsError) {
          reportClientError("kirai", "api_client", conversationsError);
          if (active && local[0]) await loadConversation(user.id, local[0].id);
          else if (active) setNotice("Tus conversaciones anteriores aparecerán cuando haya conexión.");
        }
      } catch (localConversationsError) {
        reportClientError("kirai", "kirai_chat", localConversationsError);
        if (active) setNotice("No pudimos cargar el historial guardado en este dispositivo.");
      }
    })();
    return () => { active = false; generationRef.current += 1; };
  }, [user?.id, loadConversation]);

  useFocusEffect(useCallback(() => {
    reportScreenOpened("kirai");
  }, []));

  useEffect(() => {
    if (!shouldScrollRef.current) return;
    const frame = requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    return () => cancelAnimationFrame(frame);
  }, [messages, busy]);

  const refreshConversations = async (authUserId: string) => {
    try {
      const remote = await loadKiraiConversations();
      await cacheKiraiConversations(authUserId, remote);
    } catch (refreshError) {
      reportClientError("kirai", "api_client", refreshError);
    }
    setConversations(await listLocalKiraiConversations(authUserId));
  };

  const sendQuestion = async (content: string, retryRequestId?: string) => {
    if (!user || busy || !content.trim()) return;
    const clean = content.trim();
    const requestId = retryRequestId ?? newKiraiId();
    const targetConversation = conversationId ?? newKiraiId();
    const requestGeneration = generationRef.current;
    setConversationId(targetConversation);
    setQuestion("");
    setNotice("");
    setBusy(true);
    setSendingRequestId(requestId);
    shouldScrollRef.current = true;
    try {
      await deliverKiraiQuestion({
        authUserId: user.id,
        conversationId: targetConversation,
        requestId,
        content: clean,
        savePending: savePendingKiraiQuestion,
        onSaved: (pending) => setMessages((current) => current.some((item) => item.requestId === requestId) ? current.map((item) => item.requestId === requestId ? pending : item) : [...current, pending]),
        readLocalContext: readPendingPetContext,
        ask: askKirai,
        complete: completePendingKiraiQuestion,
        fail: failPendingKiraiQuestion,
      });
      if (activeUserRef.current !== user.id || generationRef.current !== requestGeneration) return;
      const rows = await listLocalKiraiMessages(user.id, targetConversation);
      setMessages(rows);
      await refreshConversations(user.id);
    } catch (sendError) {
      reportClientError("kirai", "api_client", sendError);
      if (activeUserRef.current !== user.id || generationRef.current !== requestGeneration) return;
      setMessages((current) => current.map((item) => item.requestId === requestId ? { ...item, requestStatus: "failed" } : item));
      setNotice(requestErrorMessage(sendError));
    } finally {
      if (activeUserRef.current === user.id && generationRef.current === requestGeneration) {
        setSendingRequestId(null);
        setBusy(false);
      }
    }
  };

  const loadOlder = async () => {
    if (!user || !conversationId || !hasOlderMessages || loadingHistory) return;
    const targetConversation = conversationId;
    const generation = generationRef.current;
    setLoadingHistory(true);
    shouldScrollRef.current = false;
    try {
      const page = await loadKiraiMessagePage(targetConversation, olderOffset, 100);
      if (generation !== generationRef.current || conversationId !== targetConversation || activeUserRef.current !== user.id) return;
      await cacheKiraiMessages(user.id, targetConversation, page.messages);
      setMessages((current) => [...page.messages, ...current]);
      setOlderOffset((offset) => offset + page.messages.length);
      setHasOlderMessages(page.hasMore);
    } catch (historyError) {
      reportClientError("kirai", "api_client", historyError);
      setNotice("No pudimos cargar mensajes anteriores.");
    }
    finally { if (generation === generationRef.current) setLoadingHistory(false); }
  };

  const selectConversation = async (item: KiraiConversation) => {
    if (!user || busy) return;
    setHistoryOpen(false);
    setQuestion("");
    await loadConversation(user.id, item.id);
  };

  const startNewConversation = () => {
    if (busy) return;
    generationRef.current += 1;
    setConversationId(null);
    setMessages([]);
    setQuestion("");
    setNotice("");
    setHasOlderMessages(false);
    setOlderOffset(0);
    shouldScrollRef.current = true;
  };

  useEffect(() => {
    reportComponentState("kirai", "kirai_chat", {
      loading: authLoading || loadingHistory,
      authenticated: Boolean(user),
      busy,
      dataCount: messages.length,
      secondaryCount: conversations.length,
      errorPresent: Boolean(notice || authError),
      availability,
      renderBranch: authLoading || loadingHistory
        ? "loading"
        : !user
          ? "unauthenticated"
          : messages.length
            ? "data"
            : "empty",
    });
  }, [authError, authLoading, availability, busy, conversations.length, loadingHistory, messages.length, notice, user]);

  if (authLoading) return <SafeAreaView style={styles.safeArea}><View style={styles.center}><ActivityIndicator color={colors.blue} /><Text style={styles.muted}>Comprobando tu sesión…</Text></View></SafeAreaView>;
  if (!user) return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.authCard}><Text style={styles.title}>Inicia sesión para conversar con KIRAI</Text><Text style={styles.muted}>{authError ?? "Tus conversaciones se guardan por separado en tu cuenta."}</Text>{authError ? <AppButton label="Reintentar sesión" variant="secondary" onPress={() => void restore()} /> : null}<AppButton label="Iniciar sesión" onPress={() => router.push({ pathname: "/auth", params: { mode: "login" } })} /></View>
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={Platform.OS === "ios" ? 8 : 0}>
        <View style={[styles.chat, wide && styles.chatWide]}>
          <View style={styles.header}>
            <View style={styles.agentAvatar}><MessageCircle size={20} color={colors.onAccent} /></View>
            <View style={styles.headerCopy}><Text style={styles.title}>KIRAI</Text><Text numberOfLines={2} style={styles.status}>{availability === "available" ? "Asistente de bienestar · En línea" : availability === "checking" ? "Preparando el chat…" : "Puede responder cuando recupere conexión"}</Text></View>
            <Pressable accessibilityRole="button" accessibilityLabel="Ver historial de conversaciones" onPress={() => { void refreshConversations(user.id); setHistoryOpen(true); }} style={styles.headerAction}><Clock3 size={18} color={colors.blue} /></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Nueva conversación" onPress={startNewConversation} style={styles.headerAction}><Plus size={19} color={colors.blue} /></Pressable>
          </View>
          <View style={styles.safetyNote}><Text style={styles.safetyText}>KIRAI usa tus registros de PetCare y los cambios guardados en este dispositivo. Sus recomendaciones no reemplazan la atención veterinaria.</Text></View>
          {notice ? <Text accessibilityRole="alert" style={styles.notice}>{notice}</Text> : null}
          <ScrollView
            ref={scrollRef}
            style={styles.messagesScroll}
            contentContainerStyle={styles.messageList}
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={() => { if (shouldScrollRef.current) scrollRef.current?.scrollToEnd({ animated: true }); }}
          >
            {hasOlderMessages ? <Pressable accessibilityRole="button" onPress={() => void loadOlder()} style={styles.olderButton}><Text style={styles.olderText}>{loadingHistory ? "Cargando…" : "Cargar mensajes anteriores"}</Text></Pressable> : null}
            {messages.map((message) => (
              <View key={message.id} style={[styles.messageRow, message.role === "user" ? styles.userRow : styles.agentRow]}>
                <View style={[styles.bubble, message.role === "user" ? styles.userBubble : styles.agentBubble]}>
                  <Text style={[styles.messageAuthor, message.role === "user" && styles.userAuthor]}>{message.role === "user" ? "Tú" : "KIRAI"}</Text>
                  <Text selectable style={[styles.messageText, message.role === "user" && styles.userMessageText]}>{message.content}</Text>
                  {kiraiDeliveryLabel(message, sendingRequestId) ? <Text style={[styles.deliveryStatus, message.requestStatus === "failed" && styles.failedStatus]}>{kiraiDeliveryLabel(message, sendingRequestId)}</Text> : null}
                  {message.role === "user" && message.requestId && (message.requestStatus === "failed" || (message.requestStatus === "pending" && message.requestId !== sendingRequestId)) ? <Pressable accessibilityRole="button" disabled={busy} onPress={() => void sendQuestion(message.content, message.requestId ?? undefined)} style={styles.retryAction}><Text style={styles.retryText}>Reintentar envío</Text></Pressable> : null}
                  {message.role === "assistant" && message.truncated ? <Text style={styles.messageMeta}>La respuesta puede estar incompleta.</Text> : null}
                </View>
              </View>
            ))}
            {busy ? <View style={[styles.messageRow, styles.agentRow]}><View style={[styles.bubble, styles.agentBubble, styles.typing]}><Text style={styles.messageAuthor}>KIRAI</Text><View style={styles.typingRow}><ActivityIndicator size="small" color={colors.blue} /><Text style={styles.messageMeta}>Está escribiendo…</Text></View></View></View> : null}
            {messages.length === 0 && !busy ? <View style={styles.empty}><View style={styles.emptyIcon}><MessageCircle size={22} color={colors.blue} /></View><Text style={styles.emptyTitle}>¿En qué te puedo ayudar?</Text><Text style={styles.muted}>Pregunta por una mascota, su historial, sus cuidados o sus próximos eventos.</Text></View> : null}
          </ScrollView>
          <View style={styles.composer}>
            <TextInput
              accessibilityLabel="Mensaje para KIRAI"
              value={question}
              onChangeText={setQuestion}
              placeholder="Escribe un mensaje…"
              placeholderTextColor={colors.textMuted}
              style={styles.input}
              multiline
              maxLength={2_000}
              editable={!busy}
              onSubmitEditing={() => { if (Platform.OS === "ios") void sendQuestion(question); }}
            />
            <Pressable accessibilityRole="button" accessibilityLabel="Enviar mensaje" disabled={busy || !question.trim()} onPress={() => void sendQuestion(question)} style={[styles.sendButton, (busy || !question.trim()) && styles.sendDisabled]}>
              {busy ? <ActivityIndicator color={colors.onAccent} size="small" /> : <Send size={18} color={colors.onAccent} />}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
      <Modal visible={historyOpen} transparent animationType="slide" onRequestClose={() => setHistoryOpen(false)}>
        <View style={styles.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setHistoryOpen(false)} accessibilityLabel="Cerrar historial" />
          <View style={[styles.historySheet, wide && styles.historySheetWide]}>
            <View style={styles.historyHeader}><Text style={styles.historyTitle}>Conversaciones</Text><Pressable accessibilityRole="button" onPress={() => setHistoryOpen(false)} style={styles.headerAction}><X size={20} color={colors.text} /></Pressable></View>
            <ScrollView contentContainerStyle={styles.historyList}>
              {conversations.map((item) => <Pressable key={item.id} accessibilityRole="button" onPress={() => void selectConversation(item)} style={styles.historyItem}><Text numberOfLines={1} style={styles.historyItemTitle}>{item.title}</Text><Text style={styles.historyItemDate}>{new Date(item.lastMessageAt).toLocaleDateString("es-CO", { day: "numeric", month: "short" })}</Text></Pressable>)}
              {conversations.length === 0 ? <Text style={styles.muted}>Tus conversaciones aparecerán aquí.</Text> : null}
            </ScrollView>
            <AppButton label="Nueva conversación" icon={Plus} onPress={() => { setHistoryOpen(false); startNewConversation(); }} />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  chat: { flex: 1, width: "100%", alignSelf: "center", backgroundColor: colors.background },
  chatWide: { maxWidth: 880 },
  header: { minHeight: 66, flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface },
  agentAvatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.blue, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  headerCopy: { flex: 1, minWidth: 0, paddingVertical: 4 },
  title: { color: colors.text, fontSize: 17, fontWeight: "800" },
  status: { color: colors.textMuted, fontSize: 10, lineHeight: 14, marginTop: 2, flexShrink: 1 },
  headerAction: { width: 36, height: 36, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", backgroundColor: colors.blueSoft, flexShrink: 0 },
  safetyNote: { marginHorizontal: spacing.xs, marginTop: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.sm, backgroundColor: colors.blueSoft },
  safetyText: { color: colors.blueDark, fontSize: 10, lineHeight: 14, textAlign: "center" },
  notice: { color: colors.orange, fontSize: 12, lineHeight: 18, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  messagesScroll: { flex: 1 },
  messageList: { flexGrow: 1, gap: spacing.sm, padding: spacing.md, paddingBottom: spacing.lg },
  messageRow: { width: "100%", flexDirection: "row" },
  userRow: { justifyContent: "flex-end" },
  agentRow: { justifyContent: "flex-start" },
  bubble: { maxWidth: "86%", minWidth: 96, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: 18, gap: 4 },
  userBubble: { backgroundColor: colors.blue, borderBottomRightRadius: 5 },
  agentBubble: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderBottomLeftRadius: 5 },
  messageAuthor: { color: colors.blue, fontSize: 10, fontWeight: "800", letterSpacing: 0.3 },
  userAuthor: { color: "#DBEAFE", textAlign: "right" },
  messageText: { color: colors.text, fontSize: 14, lineHeight: 21 },
  userMessageText: { color: colors.onAccent },
  messageMeta: { color: colors.textMuted, fontSize: 10, lineHeight: 15 },
  deliveryStatus: { color: colors.blueDark, fontSize: 10, textAlign: "right", paddingTop: 2 },
  failedStatus: { color: colors.orange, fontWeight: "700" },
  retryAction: { minHeight: 32, justifyContent: "center", alignSelf: "flex-end", paddingLeft: spacing.sm, paddingTop: 2 },
  retryText: { color: colors.blue, fontSize: 11, fontWeight: "800" },
  typing: { minWidth: 160 },
  typingRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xs },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.sm, padding: spacing.xl },
  emptyIcon: { width: 48, height: 48, borderRadius: 16, backgroundColor: colors.blueSoft, alignItems: "center", justifyContent: "center" },
  emptyTitle: { color: colors.text, fontSize: 16, fontWeight: "800" },
  muted: { color: colors.textMuted, fontSize: 12, lineHeight: 18, textAlign: "center" },
  olderButton: { alignSelf: "center", paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
  olderText: { color: colors.blue, fontSize: 12, fontWeight: "700" },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface },
  input: { flex: 1, maxHeight: 130, minHeight: 44, borderWidth: 1, borderColor: colors.border, borderRadius: 22, paddingHorizontal: spacing.md, paddingTop: 11, paddingBottom: 10, backgroundColor: colors.background, color: colors.text, fontSize: 14, lineHeight: 20 },
  sendButton: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: colors.blue },
  sendDisabled: { opacity: 0.5 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md },
  authCard: { flex: 1, justifyContent: "center", gap: spacing.md, padding: spacing.lg },
  modalBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(15,23,42,0.48)" },
  historySheet: { maxHeight: "82%", padding: spacing.lg, paddingBottom: spacing.xl, borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: colors.surface, gap: spacing.md },
  historySheetWide: { width: "100%", maxWidth: 560, alignSelf: "center", marginBottom: 20, borderRadius: 24 },
  historyHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  historyTitle: { color: colors.text, fontSize: 18, fontWeight: "800" },
  historyList: { gap: spacing.xs },
  historyItem: { minHeight: 54, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.sm, backgroundColor: colors.background },
  historyItemTitle: { flex: 1, color: colors.text, fontSize: 13, fontWeight: "700" },
  historyItemDate: { color: colors.textMuted, fontSize: 11 },
});
