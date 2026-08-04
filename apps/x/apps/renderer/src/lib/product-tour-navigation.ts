export type ProductTourVariant = "main" | "relationships" | "meetings" | "actions";

export type ProductTourNavigation =
  | "home"
  | "relationships"
  | "meetings"
  | "actions"
  | "chat"
  | "email"
  | "knowledge"
  | "none";

export function productTourNavigationForTarget(
  target: string,
  variant: ProductTourVariant,
): ProductTourNavigation {
  switch (target) {
    case "accounts":
      return "relationships";
    case "home-accounts":
    case "tools":
      return "home";
    case "evidence-inbox":
      return "email";
    case "attention-queue":
    case "evidence":
    case "relationship-correction":
      return "relationships";
    case "evidence-nav":
      return "knowledge";
    case "relationship-action":
      return variant === "relationships" ? "relationships" : "home";
    case "meetings":
    case "meeting-notes":
      return "meetings";
    case "actions":
      return "actions";
    case "assistant":
    case "chat-composer":
      return "chat";
    default:
      return "none";
  }
}
