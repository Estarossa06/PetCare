import { useEffect } from "react";
import type { ErrorBoundaryProps } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { reportRenderError, type DiagnosticScreenName } from "./renderDiagnostics";

export function createDiagnosticErrorBoundary(screen: DiagnosticScreenName) {
  return function DiagnosticErrorBoundary({ error, retry }: ErrorBoundaryProps) {
    useEffect(() => {
      reportRenderError(screen, error);
    }, [error]);

    return (
      <View style={styles.container}>
        <Text accessibilityRole="alert" style={styles.title}>No se pudo mostrar esta pantalla.</Text>
        <Pressable accessibilityRole="button" onPress={() => { void retry(); }} style={styles.button}>
          <Text style={styles.buttonText}>Reintentar</Text>
        </Pressable>
      </View>
    );
  };
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16, padding: 24, backgroundColor: "#F5F8FC" },
  title: { color: "#172033", fontSize: 16, fontWeight: "700", textAlign: "center" },
  button: { minHeight: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: 20, borderRadius: 12, backgroundColor: "#2563EB" },
  buttonText: { color: "#FFFFFF", fontSize: 14, fontWeight: "700" },
});
