import { observer } from "mobx-react";
import * as React from "react";
import styled from "styled-components";
import { ClaudeStyleChat } from "~/components/AIChat/ClaudeStyleChat";

/**
 * AI Agent panel body. Renders the Claude / assistant-ui inspired AI Chat
 * surface, connected directly to `AgentStore` for end-to-end real-time chat.
 */
const Agent = observer(function Agent() {
  return (
    <Body>
      <ClaudeStyleChat />
    </Body>
  );
});

const Body = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  overflow: hidden;
`;

export default Agent;
