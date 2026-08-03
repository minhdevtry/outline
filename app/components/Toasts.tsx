import { observer } from "mobx-react";
import { Toaster } from "sonner";
import styled, { useTheme } from "styled-components";
import useStores from "~/hooks/useStores";
import type { ResolvedTheme } from "~/stores/UiStore";

function Toasts() {
  const { ui } = useStores();
  const theme = useTheme();

  return (
    <StyledToaster
      // @ts-expect-error styled-components overrides sonner's theme prop with DefaultTheme
      theme={ui.resolvedTheme as ResolvedTheme}
      closeButton
      toastOptions={{
        duration: 5000,
        style: {
          color: theme.toastText,
          background: theme.toastBackground,
          border: `1px solid ${theme.divider}`,
          fontFamily: theme.fontFamily,
          fontSize: "14px",
        },
      }}
    />
  );
}

const StyledToaster = styled(Toaster)`
  [data-sonner-toast] {
    position: relative;
    overflow: hidden;
    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
    transition:
      transform 200ms cubic-bezier(0.16, 1, 0.3, 1),
      opacity 200ms ease;
  }

  [data-sonner-toast]::after {
    content: "";
    position: absolute;
    bottom: 0;
    left: 0;
    height: 3px;
    width: 100%;
    background: linear-gradient(
      90deg,
      ${(props) => props.theme.accent} 0%,
      #10b981 100%
    );
    animation: toastProgress 5s linear forwards;
  }

  @keyframes toastProgress {
    from {
      width: 100%;
    }
    to {
      width: 0%;
    }
  }

  [data-close-button] {
    cursor: var(--pointer);
    opacity: 0.6;
    transition: opacity 150ms ease;

    &:hover {
      opacity: 1;
    }
  }

  [data-sonner-toast][data-expanded="true"] {
    [data-close-button] {
      opacity: 1;
    }
  }
`;

export default observer(Toasts);
