import type { LocalPetContext } from "./localContext";
import type { KiraiMessage } from "./storage";

export interface DeliverKiraiQuestionInput<Result> {
  authUserId: string;
  conversationId: string;
  requestId: string;
  content: string;
  savePending: (authUserId: string, conversationId: string, requestId: string, content: string) => Promise<KiraiMessage>;
  onSaved: (message: KiraiMessage) => void;
  readLocalContext: (authUserId: string) => Promise<LocalPetContext>;
  ask: (input: { message: string; conversationId: string; requestId: string; localContext: LocalPetContext }) => Promise<Result>;
  complete: (authUserId: string, conversationId: string, requestId: string, result: Result) => Promise<void>;
  fail: (authUserId: string, requestId: string) => Promise<void>;
}

/** Persist first; acknowledge locally only after the API returns a validated result. */
export async function deliverKiraiQuestion<Result extends {
  userMessage: { id: string; createdAt: string; content: string };
  assistantMessage: { id: string; createdAt: string; content: string; truncated: boolean };
}>(input: DeliverKiraiQuestionInput<Result>): Promise<Result> {
  const pending = await input.savePending(input.authUserId, input.conversationId, input.requestId, input.content);
  input.onSaved(pending);

  try {
    const localContext = await input.readLocalContext(input.authUserId);
    const result = await input.ask({
      message: input.content,
      conversationId: input.conversationId,
      requestId: input.requestId,
      localContext,
    });
    await input.complete(input.authUserId, input.conversationId, input.requestId, result);
    return result;
  } catch (error) {
    await input.fail(input.authUserId, input.requestId).catch(() => undefined);
    throw error;
  }
}
