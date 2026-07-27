type EnqueueResult = {
  skipped: boolean;
};

type OperationalLogger = Pick<Console, "error" | "log">;

function getSafeErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown queue error";
  return message.slice(0, 500);
}

export async function respondToOperationalWebhook({
  request,
  payload,
  shop,
  topic,
  enqueue,
  logger = console,
}: {
  request: Request;
  payload: unknown;
  shop: string;
  topic: string;
  enqueue: (input: {
    request: Request;
    payload: unknown;
    shop: string;
    topic: string;
  }) => Promise<EnqueueResult>;
  logger?: OperationalLogger;
}) {
  try {
    const result = await enqueue({ request, payload, shop, topic });

    logger.log(
      result.skipped
        ? `Skipped duplicate ${topic} webhook for ${shop}`
        : `Queued ${topic} webhook for ${shop}`,
    );

    return new Response(null, { status: 200 });
  } catch (error) {
    logger.error(`Failed to queue ${topic} webhook for ${shop}.`, {
      message: getSafeErrorMessage(error),
    });

    return new Response("Webhook queue temporarily unavailable.", {
      status: 503,
    });
  }
}
