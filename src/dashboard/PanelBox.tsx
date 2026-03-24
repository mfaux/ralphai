/**
 * PanelBox — reusable bordered wrapper for dashboard panels.
 *
 * Renders children inside a rounded-border Ink <Box>. Active panels get a
 * cyan border; inactive panels get a dim gray border. The title is rendered
 * as the first line inside the border with bold styling.
 */

import React from "react";
import { Box, Text } from "ink";

interface PanelBoxProps {
  title: string;
  active: boolean;
  width: number;
  height?: number;
  children?: React.ReactNode;
}

export function PanelBox({
  title,
  active,
  width,
  height,
  children,
}: PanelBoxProps) {
  const borderColor = active ? "cyan" : "gray";

  return (
    <Box
      flexDirection="column"
      width={width}
      height={height}
      borderStyle="round"
      borderColor={borderColor}
      borderDimColor={!active}
      overflow="hidden"
    >
      <Text
        bold={active}
        color={active ? "cyan" : undefined}
        dimColor={!active}
      >
        {title}
      </Text>
      {children}
    </Box>
  );
}
