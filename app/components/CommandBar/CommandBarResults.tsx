import { useMatches, KBarResults } from "kbar";
import styled from "styled-components";
import CommandBarItem from "./CommandBarItem";

export default function CommandBarResults() {
  const { results, rootActionId } = useMatches();

  if (results.length === 0) {
    return null;
  }

  return (
    <Container>
      <KBarResults
        items={results}
        maxHeight={420}
        onRender={({ item, active }) =>
          typeof item === "string" ? (
            <Header>
              <SectionBadge>{item}</SectionBadge>
            </Header>
          ) : (
            <CommandBarItem
              action={item}
              active={active}
              currentRootActionId={rootActionId}
            />
          )
        }
      />
    </Container>
  );
}

// Cannot style KBarResults directly, so we target via wrapper
const Container = styled.div`
  > div {
    padding-bottom: 8px;
  }
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  padding: 12px 16px 4px 16px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: ${(props) => props.theme.textTertiary};
  cursor: default;
`;

const SectionBadge = styled.span`
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.05em;
  background: ${(props) =>
    props.theme.sidebarControlHoverBackground ||
    props.theme.backgroundSecondary};
  color: ${(props) => props.theme.textSecondary};
  border: 1px solid ${(props) => props.theme.divider};
`;
