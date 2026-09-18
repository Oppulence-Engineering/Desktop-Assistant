import type { Meta, StoryObj } from "@storybook/react";
import * as React from "react";

import { DateTimePicker } from "@oppulence/ui/components/date-time-picker";

const meta = {
  title: "@oppulence/ui/DateTimePicker",
  component: DateTimePicker,
  tags: ["autodocs"],
} satisfies Meta<typeof DateTimePicker>;

export default meta;

type Story = StoryObj<typeof meta>;

function ControlledPicker(props: Omit<React.ComponentProps<typeof DateTimePicker>, "onChange">) {
  const [value, setValue] = React.useState(props.value ?? "");
  return <DateTimePicker {...props} value={value} onChange={setValue} />;
}

export const Empty: Story = {
  render: () => <ControlledPicker aria-label="Due date" placeholder="Choose due date" />,
};

export const WithValue: Story = {
  render: () => (
    <ControlledPicker
      aria-label="Due date"
      value="2026-09-17T14:30:00.000Z"
      placeholder="Choose due date"
    />
  ),
};
