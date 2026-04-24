export class AppError extends Error {
  constructor(message, statusCode = 400, details = undefined) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

export function toPublicError(error) {
  if (error instanceof AppError) {
    return {
      message: error.message,
      details: error.details
    };
  }

  return {
    message: 'Unexpected server error'
  };
}
