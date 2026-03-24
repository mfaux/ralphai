/**
 * PanelBox — reusable bordered wrapper for dashboard panels.
 *
 * Renders children inside a rounded-border Ink <Box>. Active panels get a
 * cyan border; inactive panels get a dim gray border. The title is rendered
 * as the first line inside the border with bold styling.
 *
 * When `collapsed` is true the box shrinks to a single content row (border
 * top + title + border bottom = 3 terminal rows).
 */

import React from "react";
import { Box, Text } from "ink";

interface PanelBoxProps {
  title: string;
  active: boolean;
  width: number;
  height?: number;
  collapsed?: boolean;
  children?: React.ReactNode;
}

export function PanelBox({
  title,
  active,
  width,
  height,
  collapsed,
  children,
}: PanelBoxProps) {
  const borderColor = active ? "cyan" : "gray";

  if (collapsed) {
    return (
      <Box
        flexDirection="column"
        width={width}
        height={3}
        borderStyle="round"
        borderColor={borderColor}
        borderDimColor={!active}
      >
        <Text
          bold={active}
          color={active ? "cyan" : undefined}
          dimColor={!active}
        >
          {title}
        </Text>
      </Box>
    );
  }

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
