/* tslint:disable max-classes-per-file */
import Purview from "../src/purview"
import { JSDOM } from "jsdom"
import * as WebSocket from "ws"
import * as http from "http"
import * as net from "net"

const { document } = new JSDOM().window

test("createElem", () => {
  const p = (
    <p>
      A paragraph
      <img src="foo" class="bar" />
    </p>
  )
  expect(p.nodeName).toBe("p")
  expect(p.attributes).toEqual({})
  expect(p.children).toHaveLength(2)
  expect(p.children[0]).toBe("A paragraph")

  const img = p.children[1] as JSX.Element
  expect(img.nodeName).toBe("img")
  expect(img.attributes).toEqual({ src: "foo", class: "bar" })
  expect(img.children).toEqual([])
})

test("createElem autocomplete", () => {
  const select = (
    <select>
      <option>First</option>
    </select>
  )
  expect(select.attributes).toEqual({})

  const selectSelected = (
    <select>
      <option selected>First</option>
    </select>
  )
  expect(selectSelected.attributes).toHaveProperty("autocomplete", "off")
})

test("render simple", () => {
  class Foo extends Purview.Component<{}, {}> {
    render(): JSX.Element {
      return (
        <p>
          A paragraph
          <img src="foo" class="bar" />
        </p>
      )
    }
  }

  const p = parse(Purview.render(<Foo />))
  expect(p.childNodes[0].textContent).toEqual("A paragraph")

  const img = p.childNodes[1] as Element
  expect(img.getAttribute("src")).toEqual("foo")
  expect(img.getAttribute("class")).toEqual("bar")
})

test("render setState", async () => {
  let instance: Foo = null as any
  class Foo extends Purview.Component<{}, { text: string }> {
    constructor(props: {}) {
      super(props)
      this.state = { text: "hi" }
      instance = this
    }

    render(): JSX.Element {
      return <p>{this.state.text}</p>
    }
  }

  await renderAndConnect(<Foo />, async client => {
    instance.setState({ text: "hello" })

    const message = (await client.messages.next()) as UpdateMessage
    expect(message.type).toBe("update")
    expect(message.componentID).toBe(client.rootID)
    expect(parse(message.html).textContent).toBe("hello")
  })
})

test("render DOM event", async () => {
  class Foo extends Purview.Component<{}, { text: string }> {
    constructor(props: {}) {
      super(props)
      this.state = { text: "hi" }
    }

    setText = () => {
      this.setState({ text: "hello" })
    }

    render(): JSX.Element {
      return <p onClick={this.setText}>{this.state.text}</p>
    }
  }

  await renderAndConnect(<Foo />, async client => {
    const event: EventMessage = {
      type: "event",
      eventID: client.elem.getAttribute("data-onclick") as string,
    }
    client.ws.send(JSON.stringify(event))

    const message = (await client.messages.next()) as UpdateMessage
    expect(message.type).toBe("update")
    expect(message.componentID).toBe(client.rootID)
    expect(parse(message.html).textContent).toBe("hello")
  })
})

test("render retain state", async () => {
  class Foo extends Purview.Component<{}, { text: string }> {
    constructor(props: {}) {
      super(props)
      this.state = { text: "hi" }
    }

    setText = () => this.setState({ text: "hello" })

    render(): JSX.Element {
      return (
        <div onClick={this.setText}>
          <p>{this.state.text}</p>
          <Bar initialCount={100} />
        </div>
      )
    }
  }

  class Bar extends Purview.Component<
    { initialCount: number },
    { count: number }
  > {
    constructor(props: { initialCount: number }) {
      super(props)
      this.state = { count: props.initialCount }
    }

    increment = () => this.setState(state => ({ count: state.count + 1 }))

    render(): JSX.Element {
      return <span onClick={this.increment}>{this.state.count}</span>
    }
  }

  await renderAndConnect(<Foo />, async client => {
    const span = client.elem.querySelector("span") as Element
    const event1: EventMessage = {
      type: "event",
      eventID: span.getAttribute("data-onclick") as string,
    }
    client.ws.send(JSON.stringify(event1))

    const message1 = (await client.messages.next()) as UpdateMessage
    expect(message1.type).toBe("update")
    expect(message1.componentID).toBe(span.getAttribute("data-component-id"))
    expect(parse(message1.html).textContent).toBe("101")

    const event2: EventMessage = {
      type: "event",
      eventID: client.elem.getAttribute("data-onclick") as string,
    }
    client.ws.send(JSON.stringify(event2))

    const message2 = (await client.messages.next()) as UpdateMessage
    expect(message2.type).toBe("update")
    expect(message2.componentID).toBe(client.rootID)

    // 101 should be retained from the previous state update.
    const div = parse(message2.html)
    expect((div.querySelector("p") as Element).textContent).toBe("hello")
    expect((div.querySelector("span") as Element).textContent).toBe("101")
  })
})

test("componentDidMount", async () => {
  let mounted = false
  class Foo extends Purview.Component<{}, { text: string }> {
    componentDidMount(): void {
      mounted = true
    }

    render(): JSX.Element {
      return <div />
    }
  }

  expect(mounted).toBe(false)
  await renderAndConnect(<Foo />, async () => {
    expect(mounted).toBe(true)
  })
})

test("componentWillUnmount", async () => {
  let unmounted = false
  class Foo extends Purview.Component<{}, { text: string }> {
    componentWillUnmount(): void {
      unmounted = true
    }

    render(): JSX.Element {
      return <div />
    }
  }

  await renderAndConnect(<Foo />, async () => {
    expect(unmounted).toBe(false)
  })

  // Must wait for close to propagate to server.
  await new Promise(resolve => setTimeout(resolve, 25))
  expect(unmounted).toBe(true)
})

test("componentWillReceiveProps", async () => {
  let instance: Foo = null as any
  let receivedProps: { count: number } | null = null

  class Foo extends Purview.Component<{}, { count: number }> {
    constructor(props: {}) {
      super(props)
      instance = this
      this.state = { count: 0 }
    }

    setCount = () => this.setState({ count: 1 })

    render(): JSX.Element {
      return <Bar count={1} />
    }
  }

  class Bar extends Purview.Component<{ count: number }, {}> {
    componentWillReceiveProps(props: { count: number }): void {
      receivedProps = props
    }

    render(): JSX.Element {
      return <p>{this.props.count}</p>
    }
  }

  await renderAndConnect(<Foo />, async client => {
    expect(receivedProps).toBe(null)
    instance.setCount()
    await client.messages.next()
    expect(receivedProps).toEqual({ count: 1, children: [] })
  })
})

async function renderAndConnect<T>(
  jsxElem: JSX.Element,
  callback: (
    client: {
      ws: WebSocket
      rootID: string
      elem: Element
      messages: AsyncQueue<ServerMessage>
    },
  ) => Promise<T>,
): Promise<T> {
  const server = http.createServer()
  await new Promise(resolve => server.listen(resolve))

  Purview.handleWebSocket(server)
  const elem = parse(Purview.render(jsxElem))
  const id = elem.getAttribute("data-component-id")
  if (!id) {
    throw new Error(`Expected component ID, but got: ${id}`)
  }

  const addr = server.address() as net.AddressInfo
  const ws = new WebSocket(`ws://127.0.0.1:${addr.port}`)
  await new Promise(resolve => (ws.onopen = resolve))

  const messages = new AsyncQueue<ServerMessage>()
  await new Promise(resolve => {
    ws.onmessage = messageEvent => {
      const message = JSON.parse(messageEvent.data.toString())
      switch (message.type) {
        case "connected":
          resolve()
          break

        default:
          messages.push(message)
      }
    }

    const connect: ClientMessage = {
      type: "connect",
      rootIDs: [id],
    }
    ws.send(JSON.stringify(connect))
  })

  let result
  try {
    result = await callback({ ws, rootID: id, elem, messages })
  } finally {
    server.close()
    ws.close()
  }
  return result
}

class AsyncQueue<T> {
  private queue: T[] = []
  private pushed: Promise<void>
  private resolvePushed: () => void

  constructor() {
    this.setPushed()
  }

  push(elem: T): void {
    this.queue.push(elem)
    this.resolvePushed()
  }

  async next(): Promise<T> {
    if (this.queue.length > 0) {
      return this.queue.shift() as T
    } else {
      await this.pushed
      return this.next()
    }
  }

  setPushed(): void {
    this.pushed = new Promise(resolve => {
      this.resolvePushed = () => {
        resolve()
        this.setPushed()
      }
    })
  }
}

function parse(html: string): Element {
  const div = document.createElement("div")
  div.innerHTML = html
  return div.firstChild as Element
}