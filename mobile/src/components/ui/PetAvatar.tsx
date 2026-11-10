import { Image, StyleSheet, Text, View } from "react-native";
import { colors } from "../../theme/tokens";

type PetAvatarProps = {
  name: string;
  emoji?: string;
  imageUri?: string | null;
  size?: "small" | "medium" | "large";
  tone?: "blue" | "yellow" | "lavender";
};

export function PetAvatar({ name, emoji = "🐾", imageUri, size = "medium", tone = "blue" }: PetAvatarProps) {
  const dimension = size === "small" ? 42 : size === "large" ? 88 : 62;
  const emojiSize = size === "small" ? 22 : size === "large" ? 43 : 31;

  return (
    <View
      accessibilityLabel={`${name}, avatar ilustrado`}
      style={[
        styles.avatar,
        { width: dimension, height: dimension, borderRadius: dimension / 2 },
        tone === "yellow" ? styles.yellow : tone === "lavender" ? styles.lavender : styles.blue,
      ]}
    >
      {imageUri ? (
        <Image accessibilityLabel={`Fotografía de ${name}`} source={{ uri: imageUri }} style={styles.photo} />
      ) : (
        <Text style={{ fontSize: emojiSize }}>{emoji}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  photo: {
    width: "100%",
    height: "100%",
  },
  blue: {
    backgroundColor: colors.blueMuted,
  },
  yellow: {
    backgroundColor: colors.yellowSoft,
  },
  lavender: {
    backgroundColor: "#EDE9FE",
  },
});
