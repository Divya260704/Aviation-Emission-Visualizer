import uvicorn


def main():
    # Start FastAPI app from the backend package.
    # Using app="backend.main:app" avoids importing at module import-time.
    uvicorn.run(
        "backend.main:app",
        host="127.0.0.1",
        port=8002,
        reload=False,
        workers=1,
        log_level="debug",
    )


if __name__ == "__main__":
    main()
