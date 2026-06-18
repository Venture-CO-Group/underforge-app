import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Keyboard, Platform, Pressable, StyleSheet } from 'react-native';

type OpenOptions = {
  /**
   * If true, do NOT dismiss the keyboard when opening this overlay, and do NOT auto-close this
   * overlay on the next keyboard show. Use for overlays that are paired with a TextInput
   * (e.g. an autocomplete dropdown anchored to a text field).
   */
  keepKeyboard?: boolean;
};

type ActiveOverlayContextValue = {
  activeId: string | null;
  open: (id: string, options?: OpenOptions) => void;
  close: (id?: string) => void;
};

const ActiveOverlayContext = createContext<ActiveOverlayContextValue>({
  activeId: null,
  open: () => {},
  close: () => {},
});

export function ActiveOverlayProvider({ children }: { children: React.ReactNode }) {
  const [activeId, setActiveId] = useState<string | null>(null);
  // One-shot suppression: when we open an overlay paired with a TextInput (keepKeyboard=true),
  // we suppress exactly the next keyboard-show event - the one that fires because the input
  // we just opened the overlay for took focus. Subsequent focus changes (a different input)
  // will still fire show events that are NOT suppressed, closing the overlay as expected.
  const suppressNextKeyboardShowRef = useRef(false);

  const open = useCallback((id: string, options?: OpenOptions) => {
    const keepKeyboard = !!options?.keepKeyboard;
    if (keepKeyboard) {
      suppressNextKeyboardShowRef.current = true;
      // Clear the suppression after a short window in case the keyboard event never fires
      // (e.g. keyboard already up). This prevents the next unrelated focus from being missed.
      setTimeout(() => {
        suppressNextKeyboardShowRef.current = false;
      }, 300);
    } else {
      Keyboard.dismiss();
    }
    setActiveId(id);
  }, []);

  const close = useCallback((id?: string) => {
    setActiveId(prev => {
      const shouldClear = !id || prev === id;
      if (shouldClear) suppressNextKeyboardShowRef.current = false;
      return shouldClear ? null : prev;
    });
  }, []);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const sub = Keyboard.addListener(showEvent, () => {
      if (suppressNextKeyboardShowRef.current) {
        suppressNextKeyboardShowRef.current = false;
        return;
      }
      setActiveId(null);
    });
    return () => sub.remove();
  }, []);

  const value = useMemo(() => ({ activeId, open, close }), [activeId, open, close]);

  return (
    <ActiveOverlayContext.Provider value={value}>{children}</ActiveOverlayContext.Provider>
  );
}

export function useActiveOverlay(id: string) {
  const { activeId, open, close } = useContext(ActiveOverlayContext);
  const isOpen = activeId === id;

  const openSelf = useCallback(
    (options?: OpenOptions) => open(id, options),
    [open, id],
  );
  const closeSelf = useCallback(() => close(id), [close, id]);
  const toggle = useCallback(
    (options?: OpenOptions) => {
      if (activeId === id) close(id);
      else open(id, options);
    },
    [activeId, id, open, close],
  );

  return { isOpen, openSelf, closeSelf, toggle };
}

export function useActiveOverlayControls() {
  const { activeId, open, close } = useContext(ActiveOverlayContext);
  const closeAny = useCallback(() => {
    close();
  }, [close]);
  return { activeId, open, closeAny };
}

type DismissOverlayBackdropProps = {
  visible: boolean;
  onDismiss?: () => void;
};

export function DismissOverlayBackdrop({ visible, onDismiss }: DismissOverlayBackdropProps) {
  const { closeAny } = useActiveOverlayControls();
  if (!visible) return null;
  return (
    <Pressable
      style={styles.backdrop}
      onPress={() => {
        closeAny();
        Keyboard.dismiss();
        onDismiss?.();
      }}
    />
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'transparent',
  },
});

export function GlobalOverlayBackdrop() {
  const { activeId } = useActiveOverlayControls();
  return <DismissOverlayBackdrop visible={!!activeId} />;
}
