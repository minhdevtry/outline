import * as React from "react";
import styled from "styled-components";
import Text from "~/components/Text";

type EmptyProps = {
  icon?: React.ReactNode;
  title?: React.ReactNode;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
};

const EmptyText = styled(Text).attrs({
  type: "tertiary",
  selectable: false,
})``;

const EmptyContainer = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 32px 16px;
  margin: 16px 0;
  border-radius: 12px;
  background: ${(props) =>
    props.theme.sidebarControlHoverBackground ||
    props.theme.backgroundSecondary};
  border: 1px dashed ${(props) => props.theme.divider};
`;

const IconWrapper = styled.div`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border-radius: 12px;
  background: ${(props) => props.theme.background};
  color: ${(props) => props.theme.textSecondary};
  margin-bottom: 12px;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.04);

  svg {
    width: 24px;
    height: 24px;
  }
`;

const Title = styled.h4`
  margin: 0 0 4px 0;
  font-size: 15px;
  font-weight: 600;
  color: ${(props) => props.theme.text};
`;

const Description = styled(Text).attrs({
  type: "tertiary",
  selectable: false,
})`
  font-size: 13px;
  max-width: 360px;
  margin: 0 auto;
`;

const ActionWrapper = styled.div`
  margin-top: 16px;
`;

const Empty: React.FC<EmptyProps> = function Empty({
  icon,
  title,
  children,
  action,
  className,
  style,
}: EmptyProps) {
  if (!icon && !title && !action) {
    return (
      <EmptyText className={className} style={style}>
        {children}
      </EmptyText>
    );
  }

  return (
    <EmptyContainer className={className} style={style}>
      {icon && <IconWrapper>{icon}</IconWrapper>}
      {title && <Title>{title}</Title>}
      {children && <Description>{children}</Description>}
      {action && <ActionWrapper>{action}</ActionWrapper>}
    </EmptyContainer>
  );
};

export default Empty;
